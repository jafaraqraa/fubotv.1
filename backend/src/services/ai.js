const { addLog, reportError } = require('./logger');
const { retrieveContextAsync, getSystemPrompt } = require('./knowledge');
const { getChatHistoryForAI } = require('../database/repositories/messageRepository');
const { validateAnswer: runValidation } = require('../rag/intelligence/answerValidator');
const PromptBuilder = require('./PromptBuilder');
const OpenRouterService = require('./OpenRouterService');
const { performance } = require('perf_hooks');

/**
 * High-resolution Timing Profiler for AI response generation pipeline.
 */
class PipelineProfiler {
    constructor() {
        this.stages = {};
        this.subStages = {};
        this.startTime = performance.now();
        this.apiDetails = {};
    }

    startStage(name) {
        this.stages[name] = { start: performance.now() };
    }

    endStage(name) {
        if (this.stages[name]) {
            this.stages[name].end = performance.now();
            this.stages[name].duration = this.stages[name].end - this.stages[name].start;
        }
    }

    recordDuration(name, ms) {
        this.stages[name] = { duration: ms };
    }

    recordSubDuration(parent, name, ms) {
        if (!this.subStages[parent]) {
            this.subStages[parent] = [];
        }
        this.subStages[parent].push({ name, duration: ms });
    }

    setApiDetails(details) {
        this.apiDetails = { ...this.apiDetails, ...details };
    }

    getReport() {
        const total = performance.now() - this.startTime;
        const report = {};
        for (const [name, data] of Object.entries(this.stages)) {
            report[name] = data.duration || 0;
        }
        return {
            stages: report,
            subStages: this.subStages,
            total,
            apiDetails: this.apiDetails
        };
    }
}

/**
 * 1. retrieveContext()
 * Retrieves context asynchronously using the retrieval engine.
 */
async function retrieveContext(userText, profiler = null) {
    return await retrieveContextAsync(userText, profiler);
}

/**
 * 2. buildPrompt()
 * Builds the final prompt/messages payload using PromptBuilder.
 */
function buildPrompt(conversationHistory, systemPrompt, context, userText) {
    return PromptBuilder.buildMessages({
        systemPrompt,
        conversationHistory,
        knowledgeContext: context,
        userQuestion: userText
    });
}

/**
 * 3. callOpenRouter()
 * Communicates with the configured AI provider to get completions response.
 * Kept exported with identical signature for absolute backward-compatible API contracts.
 */
async function callOpenRouter(messagesPayload, taskName = 'text_generation', options = {}) {
    const { getAIProviderForTask } = require('./aiProviders');
    const provider = getAIProviderForTask(taskName);

    if (!provider) {
        addLog(`⚠️ تنبيه: لم يتم العثور على مزود الخدمة للمهمة [${taskName}].`);
        return null;
    }

    // Check if API key is required and missing (Ollama runs locally and does not need keys)
    if (!provider.apiKey && (provider.constructor.name !== 'OllamaProvider')) {
        addLog(`⚠️ تنبيه: لم يتم العثور على مفتاح API للذكاء الاصطناعي الخاص بـ [${provider.constructor.name}] في ملف .env أو الإعدادات.`);
        return null;
    }

    return await provider.generate(messagesPayload, options);
}

/**
 * 4. validateAnswer()
 * Validates raw LLM response against context if context exists.
 */
function validateAnswer(rawResponse, context) {
    if (context) {
        return runValidation(rawResponse, context);
    }
    return rawResponse;
}

/**
 * Helper to fetch generation statistical details (cost/tokens) from OpenRouter.
 */
async function fetchOpenRouterGenerationDetails(generationId, apiKey) {
    if (!generationId || !apiKey) return null;
    try {
        console.log(`🌐 Querying OpenRouter Generation API for ID: ${generationId}...`);
        const url = `https://openrouter.ai/api/v1/generation?id=${generationId}`;
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
        if (res.ok) {
            const payload = await res.json();
            return payload.data || null;
        } else {
            console.warn(`⚠️ OpenRouter Generation API returned status: ${res.status}`);
        }
    } catch (err) {
        console.error('⚠️ Failed to fetch OpenRouter generation details:', err.message);
    }
    return null;
}

/**
 * Modern production-grade unified response generation pipeline.
 * Maintain backward compatibility with: getAIResponse(userId, userText)
 * Now expanded with Task-Based Image Understanding routing support!
 */
async function getAIResponse(userId, userText, messageType = 'text', mediaObj = null) {
    const startTime = Date.now();
    const profiler = new PipelineProfiler();

    const isImage = messageType === 'image' || (mediaObj && mediaObj.mimeType && mediaObj.mimeType.startsWith('image/'));
    const isAudio = messageType === 'audio' || (mediaObj && mediaObj.mimeType && mediaObj.mimeType.startsWith('audio/'));
    const activeTask = isImage ? 'vision' : 'text_generation';

    // Image Input Validation if active task is vision
    if (isImage && mediaObj) {
        const { validateIncomingImage } = require('../messaging/validateImage');
        const validation = validateIncomingImage(mediaObj);
        if (!validation.valid) {
            addLog(`⚠️ فشل التحقق من الصورة: ${validation.error}`);
            return validation.error;
        }
    }

    // Speech-To-Text Transcription Pipeline Integration
    if (isAudio && mediaObj) {
        profiler.startStage('Speech to Text');
        const { getAIProviderForTask } = require('./aiProviders');
        const sttProvider = getAIProviderForTask('speech_to_text');
        const sttModel = sttProvider ? sttProvider.model : 'whisper-1';
        const sttProviderName = sttProvider ? sttProvider.constructor.name.replace('Provider', '').toLowerCase() : 'openai';

        // Calculate file size on disk safely
        let fileSizeStr = '0 B';
        try {
            const fs = require('fs');
            const path = require('path');
            const absolutePath = mediaObj.localPath.startsWith('/') && !mediaObj.localPath.startsWith('/uploads')
                ? mediaObj.localPath
                : path.join(__dirname, '..', '..', 'public', mediaObj.localPath);
            if (fs.existsSync(absolutePath)) {
                const stats = fs.statSync(absolutePath);
                fileSizeStr = `${(stats.size / 1024).toFixed(1)} KB`;
            }
        } catch (e) {}

        console.log(`🎙️ [SPEECH-TO-TEXT ROUTING] Detected content type: [audio], Selected task: [speech_to_text], Selected provider: [${sttProviderName}], Selected model: [${sttModel}], File Size: [${fileSizeStr}]`);
        addLog(`جاري تفريغ الصوت عبر المهمة [speech_to_text] باستخدام [${sttModel}]...`);

        const sttStartTime = Date.now();
        let transcribedText = '';
        if (sttProvider && typeof sttProvider.transcribe === 'function') {
            transcribedText = await sttProvider.transcribe(mediaObj);
        } else {
            console.warn(`[STT Warning] Configured STT provider does not support transcription or is not initialized.`);
        }
        const sttDuration = Date.now() - sttStartTime;
        profiler.recordDuration('Speech to Text', sttDuration);

        console.log(`🎙️ [SPEECH-TO-TEXT RESULT] Transcribed text: "${transcribedText || ''}", Execution Time: [${sttDuration} ms]`);
        addLog(`اكتمل التفريغ الصوتي بنجاح: "${transcribedText || ''}" (${sttDuration}ms)`);
        profiler.endStage('Speech to Text');

        // Overwrite userText with transcribed text
        userText = transcribedText || '';

        // Compare raw provider text with final text passed to RAG pipeline (Audit verification 7)
        console.log(`🎙️ [SPEECH-TO-TEXT QUALITY AUDIT]`);
        console.log(`  • Raw Provider Transcribed Text: "${transcribedText || ''}"`);
        console.log(`  • Final Text Passed to RAG Pipeline: "${userText}"`);
    }

    // 1. Fetch system prompt personality, rules, safety
    const systemPrompt = getSystemPrompt();

    // 2. Retrieve Context (RAG)
    // For Vision task, let's keep context lookup if there's text/caption, else retrieve general context
    const retrievalText = isImage ? (mediaObj.caption || '') : userText;
    const context = await retrieveContext(retrievalText, profiler);

    // 3. Fetch clean conversation history (unmodified)
    const conversationHistory = getChatHistoryForAI(userId);

    // 4. Construct messages payload using Prompt Builder
    profiler.startStage('Prompt Builder');
    // If it's an image, PromptBuilder builds the same array, and we then enrich the last user message inside Providers.
    const messagesPayload = buildPrompt(conversationHistory, systemPrompt, context, isImage ? (mediaObj.caption || 'صورة مرفقة') : userText);
    profiler.endStage('Prompt Builder');

    // 5. Send payload to AI provider (Routed to the determined task)
    const { getAIProviderForTask } = require('./aiProviders');
    const taskProvider = getAIProviderForTask(activeTask);
    const activeModel = taskProvider ? taskProvider.model : (isImage ? 'gpt-4o-mini' : (process.env.AI_MODEL || process.env.OPENROUTER_MODEL || 'openrouter/free'));
    const activeProviderName = taskProvider ? taskProvider.constructor.name.replace('Provider', '').toLowerCase() : (process.env.AI_PROVIDER || 'openrouter');
    profiler.setApiDetails({ model: activeModel, provider: activeProviderName });

    // Explicit Vision Routing Log
    console.log(`🔍 [VISION ROUTING] Detected content type: [${isImage ? 'image' : 'text'}], Selected task: [${activeTask}], Selected provider: [${activeProviderName}], Selected model: [${activeModel}]`);
    addLog(`معالجة رسالة [${isImage ? 'صورة' : 'نص'}] عبر المهمة [${activeTask}] باستخدام [${activeModel}]`);

    const apiStart = Date.now();
    console.log(`🤖 AI Provider API Request started at: ${new Date(apiStart).toISOString()}`);

    // Call the specific task provider with options passing media if vision
    let rawResponse = null;
    let trackSuccess = 1;
    let trackErrorMessage = null;

    try {
        rawResponse = await callOpenRouter(messagesPayload, activeTask, { media: isImage ? mediaObj : null });
    } catch (apiErr) {
        trackSuccess = 0;
        trackErrorMessage = apiErr.message;
    }

    const apiEnd = Date.now();
    console.log(`🤖 AI Provider API Request completed at: ${new Date(apiEnd).toISOString()}`);

    const apiLatency = apiEnd - apiStart;
    const providerApiStage = `${activeProviderName.charAt(0).toUpperCase()}${activeProviderName.slice(1)} API`;
    profiler.recordDuration(providerApiStage, apiLatency);
    profiler.setApiDetails({ latency: apiLatency, startedAt: apiStart, completedAt: apiEnd });

    if (!rawResponse && trackSuccess === 1) {
        trackSuccess = 0;
        trackErrorMessage = "Empty or null response from provider.";
    }

    // 6. Validate response
    let validatedResponse = null;
    if (rawResponse) {
        profiler.startStage('Answer Validation');
        validatedResponse = validateAnswer(rawResponse, context);
        profiler.endStage('Answer Validation');
    }

    // Record AI Usage Logs to database
    try {
        const analyticsRepository = require('../analytics/analytics.repository');
        const analyticsWebSocket = require('../analytics/analytics.websocket');
        const { getLastResponseMetadata } = require('./aiProviders');

        // Extract real telemetry from Provider's global lastResponseMetadata
        const meta = getLastResponseMetadata();

        let inputTokens = meta && meta.usage ? meta.usage.prompt_tokens : null;
        let outputTokens = meta && meta.usage ? meta.usage.completion_tokens : null;
        let totalTokens = meta && meta.usage ? meta.usage.total_tokens : null;
        let finalCost = meta ? meta.cost : null;
        const generationId = meta ? meta.id : null;
        const respModel = meta ? meta.model : activeModel;

        // Fallbacks for token estimates if not provided
        if (inputTokens === null || inputTokens === undefined) {
            inputTokens = Math.ceil(JSON.stringify(messagesPayload).length / 4);
        }
        if (outputTokens === null || outputTokens === undefined) {
            outputTokens = rawResponse ? Math.ceil(rawResponse.length / 4) : 0;
        }
        if (totalTokens === null || totalTokens === undefined) {
            totalTokens = inputTokens + outputTokens;
        }

        // If provider is openrouter and cost is missing, call generation API
        if (activeProviderName.includes('openrouter') && finalCost === null && generationId && taskProvider && taskProvider.apiKey) {
            console.log(`🔄 OpenRouter request missing cost. Triggering Generation ID Fallback for ID: ${generationId}...`);
            const genDetails = await fetchOpenRouterGenerationDetails(generationId, taskProvider.apiKey);
            if (genDetails) {
                if (genDetails.cost !== undefined && genDetails.cost !== null) {
                    finalCost = parseFloat(genDetails.cost);
                }
                if (genDetails.tokens_prompt !== undefined) {
                    inputTokens = genDetails.tokens_prompt;
                }
                if (genDetails.tokens_completion !== undefined) {
                    outputTokens = genDetails.tokens_completion;
                }
                if (genDetails.tokens_prompt !== undefined && genDetails.tokens_completion !== undefined) {
                    totalTokens = genDetails.tokens_prompt + genDetails.tokens_completion;
                }
            }
        }

        // Default cost estimation fallback if cost is still not resolved
        if (finalCost === null || finalCost === undefined) {
            let costPerInput = 0.0;
            let costPerOutput = 0.0;
            const lowerProvider = activeProviderName.toLowerCase();

            if (lowerProvider.includes('openai')) {
                costPerInput = 0.0000015;  // gpt-4o-mini default estimates
                costPerOutput = 0.000002;
            } else if (lowerProvider.includes('gemini')) {
                costPerInput = 0.000000075;
                costPerOutput = 0.0000003;
            } else if (lowerProvider.includes('openrouter')) {
                // Free models or basic fallback
                costPerInput = 0.0000005;
                costPerOutput = 0.0000015;
            }

            finalCost = (inputTokens * costPerInput) + (outputTokens * costPerOutput);
        }

        // Print exactly what was retrieved/estimated from the AI provider
        console.log({
            provider: activeProviderName,
            model: respModel,
            usage: {
                prompt_tokens: inputTokens,
                completion_tokens: outputTokens,
                total_tokens: totalTokens
            },
            cost: finalCost,
            generationId
        });

        console.log('[Usage] Saving through rebuilt clean-architecture Analytics module...');

        const result = analyticsRepository.recordUsage({
            provider: activeProviderName,
            model: respModel,
            task: activeTask,
            tenant_id: 'default',
            request_time: new Date(apiStart),
            response_time: new Date(apiEnd),
            duration: apiLatency,
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            total_tokens: totalTokens,
            cost: finalCost,
            success: trackSuccess,
            error_message: trackErrorMessage,
            generation_id: generationId,
            apiKey: taskProvider ? taskProvider.apiKey : null
        });

        // Temporary tracking log requested by user
        console.log(`[UsageTracker]
Provider: ${activeProviderName}
Model: ${respModel}
Task: ${activeTask}
Prompt Tokens: ${inputTokens}
Completion Tokens: ${outputTokens}
Total Tokens: ${totalTokens}
Cost: ${finalCost}
Saved: ${result.success ? 'true' : 'false'}`);

        // Broadcast real-time Socket update to active dashboard clients
        if (result.success && trackSuccess) {
            analyticsWebSocket.broadcastUsageUpdate({
                provider: activeProviderName,
                model: respModel,
                task: activeTask,
                total_tokens: totalTokens
            });
        }
    } catch (trackErr) {
        console.error("⚠️ Failed to write usage telemetry log:", trackErr.message);
    }

    if (!rawResponse) {
        return null;
    }

    // 7. Format and print timing report
    const report = profiler.getReport();
    const stagesList = [
        { key: 'Speech to Text', label: 'Speech to Text (Transcription)' },
        { key: 'Normalization', label: 'Normalization' },
        { key: 'Intent Detection', label: 'Intent Detection' },
        { key: 'Query Planner', label: 'Query Planner' },
        { key: 'Query Decomposition', label: 'Query Decomposition' },
        { key: 'Conversation Analysis', label: 'Conversation Analysis' },
        { key: 'Synonym Expansion', label: 'Synonym Expansion' },
        { key: 'HyDE', label: 'HyDE' },
        { key: 'Embeddings (Ollama)', label: 'Embeddings (Ollama)' },
        { key: 'Vector Search (Qdrant)', label: 'Vector Search (Qdrant)' },
        { key: 'Keyword Search', label: 'Keyword Search' },
        { key: 'RRF Fusion', label: 'RRF Fusion' },
        { key: 'Cross Encoder', label: 'Cross Encoder' },
        { key: 'Context Optimizer', label: 'Context Optimizer' },
        { key: 'Prompt Builder', label: 'Prompt Builder' },
        { key: providerApiStage, label: providerApiStage },
        { key: 'Answer Validation', label: 'Answer Validation' }
    ];

    console.log(`\n================ AI PIPELINE TIMINGS ================\n`);
    let fastestName = '';
    let fastestVal = Infinity;
    let slowestName = '';
    let slowestVal = -Infinity;

    stagesList.forEach(stg => {
        const duration = report.stages[stg.key] || 0;
        const durStr = `${duration.toFixed(0)} ms`;
        const dots = '.'.repeat(Math.max(1, 30 - stg.label.length - durStr.length));
        console.log(`${stg.label} ${dots} ${durStr}`);

        // Print sub-stages if any exist for this stage
        const subs = report.subStages[stg.key];
        if (subs && Array.isArray(subs)) {
            subs.forEach(sub => {
                const subDurStr = `${sub.duration.toFixed(1)} ms`;
                const labelStr = `  • ${sub.name}`;
                const subDots = '.'.repeat(Math.max(1, 30 - labelStr.length - subDurStr.length));
                console.log(`${labelStr} ${subDots} ${subDurStr}`);
            });
        }

        if (duration > 0) {
            if (duration < fastestVal) {
                fastestVal = duration;
                fastestName = stg.label;
            }
            if (duration > slowestVal) {
                slowestVal = duration;
                slowestName = stg.label;
            }
        }
    });

    console.log(`\n----------------------------------------------------`);
    const totalDuration = report.total;
    const totalStr = `${totalDuration.toFixed(0)} ms`;
    const totalDots = '.'.repeat(Math.max(1, 30 - 5 - totalStr.length));
    console.log(`TOTAL ${totalDots} ${totalStr}`);
    console.log(`====================================================\n`);

    // OpenRouter Details
    const promptTokensEstimate = Math.ceil(JSON.stringify(messagesPayload).length / 4);
    const completionTokensEstimate = Math.ceil((rawResponse || '').length / 4);

    console.log(`🤖 AI Provider Latency Details:`);
    console.log(`  • Request Started: ${new Date(report.apiDetails.startedAt || startTime).toISOString()}`);
    console.log(`  • Request Completed: ${new Date(report.apiDetails.completedAt || Date.now()).toISOString()}`);
    console.log(`  • Total API Latency: ${(report.apiDetails.latency || 0).toFixed(0)} ms`);
    console.log(`  • Prompt Token Estimate: ~${promptTokensEstimate} tokens`);
    console.log(`  • Completion Token Estimate: ~${completionTokensEstimate} tokens`);
    console.log(`  • Model Used: ${report.apiDetails.model}`);
    console.log(`  • Provider: ${report.apiDetails.provider}`);

    // Bottleneck Detection
    if (slowestName) {
        const slowestPercentage = Math.round((slowestVal / totalDuration) * 100);
        console.log(`\n🚨 BOTTLENECK DETECTION:`);
        console.log(`  • Fastest Stage:\n    ${fastestName} (${fastestVal.toFixed(0)} ms)`);
        console.log(`  • Slowest Stage:\n    ${slowestName} (${slowestVal.toFixed(0)} ms)`);
        console.log(`  • Largest Percentage:\n    ${slowestName} (${slowestPercentage}%)`);
    }
    console.log(`====================================================\n`);

    return validatedResponse;
}

module.exports = {
    getChatHistoryForAI,
    getAIResponse,
    retrieveContext,
    buildPrompt,
    callOpenRouter,
    validateAnswer
};
