const { reportError, addLog } = require('./logger');

// Global tracker for the last provider response metadata to support multi-instance retrieval
let lastResponseMetadata = null;

function getLastResponseMetadata() {
    return lastResponseMetadata;
}

/**
 * Base AI Provider Abstraction
 */
class AIProvider {
    constructor(model, apiKey, baseUrl) {
        this.model = model;
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
    }

    /**
     * Generates a text completion for given messages payload.
     * @param {Array<Object>} messages - Array of chat messages {role, content}.
     * @param {Object} [options] - Additional optional parameters.
     * @returns {Promise<string|null>} Response content or null if failed.
     */
    async generate(messages, options = {}) {
        throw new Error('generate() method must be implemented by concrete providers.');
    }

    async transcribe(media) {
        throw new Error('transcribe() method must be implemented by concrete providers.');
    }
}

/**
 * OpenRouter AI Provider Implementation
 */
class OpenRouterProvider extends AIProvider {
    async generate(messages, options = {}) {
        try {
            const apiBase = this.baseUrl || "https://openrouter.ai/api/v1";
            const url = `${apiBase}/chat/completions`;
            const model = this.model || "openrouter/free";
            const temp = parseFloat(process.env.AI_TEMPERATURE || "0.2");

            // Logging and assertion before every request
            console.log(`[AI Request Prep]
Selected Provider: openrouter
Selected Model: ${model}
HTTP Endpoint: ${url}
Adapter Used: OpenRouterProvider`);

            if (this.constructor.name !== 'OpenRouterProvider') {
                throw new Error(`Configuration Error: Adapter mismatch inside OpenRouterProvider. Found: ${this.constructor.name}`);
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'http://localhost:3005',
                    'X-Title': 'Telegram RAG Memory Bot'
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    temperature: temp
                })
            });

            const data = await response.json();

            if (data.error) {
                reportError("OpenRouter AI Provider API", data.error.message || JSON.stringify(data.error));
                return null;
            }

            // Save telemetry
            lastResponseMetadata = {
                id: data.id || null,
                model: data.model || model,
                usage: data.usage || null,
                cost: data.cost !== undefined ? data.cost : null,
                rawResponse: data
            };

            if (data.choices && data.choices[0] && data.choices[0].message) {
                return data.choices[0].message.content;
            }

            return null;
        } catch (error) {
            console.error("❌ [OpenRouterProvider] Error:", error.message);
            addLog("خطأ في الاتصال بـ OpenRouter");
            return null;
        }
    }

    async transcribe(media) {
        try {
            const fs = require('fs');
            const path = require('path');
            const absolutePath = media.localPath.startsWith('/') && !media.localPath.startsWith('/uploads')
                ? media.localPath
                : path.join(__dirname, '..', '..', 'public', media.localPath);

            if (!fs.existsSync(absolutePath)) {
                console.error(`[OpenRouter STT] Audio file not found: ${absolutePath}`);
                return null;
            }

            const apiBase = this.baseUrl || "https://openrouter.ai/api/v1";
            const url = `${apiBase}/audio/transcriptions`;

            console.log(`🎙️ [OpenRouter STT] Requesting transcription using model: [${this.model || "openai/whisper-1"}]...`);

            const fileBuffer = fs.readFileSync(absolutePath);
            const { Blob } = require('buffer');
            const fileBlob = new Blob([fileBuffer], { type: media.mimeType || 'audio/ogg' });

            const formData = new FormData();
            formData.append('file', fileBlob, media.fileName || 'audio.ogg');
            formData.append('model', this.model || 'openai/whisper-1');
            // Force Arabic language to avoid language misdetection & improve transcription accuracy
            formData.append('language', 'ar');

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: formData
            });

            const data = await response.json();

            // Log raw transcription response from provider before post-processing
            console.log(`🎙️ [OpenRouter STT RAW RESPONSE]`, JSON.stringify(data));

            if (data.error) {
                reportError("OpenRouter STT API", data.error.message || JSON.stringify(data.error));
                return null;
            }

            return data.text || null;
        } catch (error) {
            console.error("❌ [OpenRouter STT] Error:", error.message);
            return null;
        }
    }
}

/**
 * OpenAI Provider Implementation
 */
class OpenAIProvider extends AIProvider {
    async generate(messages, options = {}) {
        try {
            const apiBase = this.baseUrl || "https://api.openai.com/v1";
            const url = `${apiBase}/chat/completions`;
            const model = this.model || "gpt-4o-mini";
            const temp = parseFloat(process.env.AI_TEMPERATURE || "0.2");

            // Logging and assertion before every request
            console.log(`[AI Request Prep]
Selected Provider: openai
Selected Model: ${model}
HTTP Endpoint: ${url}
Adapter Used: OpenAIProvider`);

            if (this.constructor.name !== 'OpenAIProvider') {
                throw new Error(`Configuration Error: Adapter mismatch inside OpenAIProvider. Found: ${this.constructor.name}`);
            }

            let finalMessages = [...messages];
            if (options.media) {
                const { convertImageToBase64 } = require('../utils/imageHelper');
                const base64Url = convertImageToBase64(options.media);
                if (base64Url && finalMessages.length > 0) {
                    const lastMsgIdx = finalMessages.length - 1;
                    const lastMsg = finalMessages[lastMsgIdx];
                    if (lastMsg.role === 'user') {
                        finalMessages[lastMsgIdx] = {
                            ...lastMsg,
                            content: [
                                { type: 'text', text: lastMsg.content || 'ماذا يوجد في هذه الصورة؟' },
                                { type: 'image_url', image_url: { url: base64Url } }
                            ]
                        };
                    }
                }
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    messages: finalMessages,
                    temperature: temp
                })
            });

            const data = await response.json();

            if (data.error) {
                reportError("OpenAI Provider API", data.error.message || JSON.stringify(data.error));
                return null;
            }

            // Save telemetry
            lastResponseMetadata = {
                id: data.id || null,
                model: data.model || model,
                usage: data.usage || null,
                cost: null,
                rawResponse: data
            };

            if (data.choices && data.choices[0] && data.choices[0].message) {
                return data.choices[0].message.content;
            }

            return null;
        } catch (error) {
            console.error("❌ [OpenAIProvider] Error:", error.message);
            addLog("خطأ في الاتصال بـ OpenAI");
            return null;
        }
    }

    async transcribe(media) {
        try {
            const fs = require('fs');
            const path = require('path');
            const absolutePath = media.localPath.startsWith('/') && !media.localPath.startsWith('/uploads')
                ? media.localPath
                : path.join(__dirname, '..', '..', 'public', media.localPath);

            if (!fs.existsSync(absolutePath)) {
                console.error(`[OpenAI STT] Audio file not found: ${absolutePath}`);
                return null;
            }

            const apiBase = this.baseUrl || "https://api.openai.com/v1";
            const url = `${apiBase}/audio/transcriptions`;

            console.log(`🎙️ [OpenAI STT] Requesting transcription using model: [${this.model || "whisper-1"}]...`);

            const fileBuffer = fs.readFileSync(absolutePath);
            const { Blob } = require('buffer');
            const fileBlob = new Blob([fileBuffer], { type: media.mimeType || 'audio/ogg' });

            const formData = new FormData();
            formData.append('file', fileBlob, media.fileName || 'audio.ogg');
            formData.append('model', this.model || 'whisper-1');
            // Force Arabic language to avoid language misdetection & improve transcription accuracy
            formData.append('language', 'ar');

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: formData
            });

            const data = await response.json();

            // Log raw transcription response from provider before post-processing
            console.log(`🎙️ [OpenAI STT RAW RESPONSE]`, JSON.stringify(data));

            if (data.error) {
                reportError("OpenAI STT API", data.error.message || JSON.stringify(data.error));
                return null;
            }

            return data.text || null;
        } catch (error) {
            console.error("❌ [OpenAI STT] Error:", error.message);
            return null;
        }
    }
}

/**
 * Google Gemini Provider Implementation (Native REST generateContent)
 */
class GeminiProvider extends AIProvider {
    async generate(messages, options = {}) {
        try {
            const model = this.model || "gemini-2.5-flash";
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

            // Logging and assertion before every request
            console.log(`[AI Request Prep]
Selected Provider: gemini
Selected Model: ${model}
HTTP Endpoint: ${url}
Adapter Used: GeminiProvider`);

            if (this.constructor.name !== 'GeminiProvider') {
                throw new Error(`Configuration Error: Adapter mismatch inside GeminiProvider. Found: ${this.constructor.name}`);
            }

            const systemMsg = messages.find(m => m.role === 'system');
            const otherMsgs = messages.filter(m => m.role !== 'system');

            // Find if there is an image to convert to base64
            let imagePart = null;
            if (options.media) {
                const { convertImageToBase64 } = require('../utils/imageHelper');
                const base64Url = convertImageToBase64(options.media);
                if (base64Url) {
                    const rawBase64 = base64Url.split(';base64,').pop();
                    const mimeType = options.media.mimeType || 'image/jpeg';
                    imagePart = {
                        inlineData: {
                            mimeType,
                            data: rawBase64
                        }
                    };
                }
            }

            const body = {
                contents: otherMsgs.map((msg, idx) => {
                    const parts = [{ text: msg.content }];
                    // For the very last user message, if we have an imagePart, we append it
                    if (idx === otherMsgs.length - 1 && msg.role === 'user' && imagePart) {
                        parts.push(imagePart);
                    }
                    return {
                        role: msg.role === 'assistant' ? 'model' : 'user',
                        parts
                    };
                })
            };

            if (systemMsg) {
                body.systemInstruction = {
                    parts: [{ text: systemMsg.content }]
                };
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            const data = await response.json();

            if (data.error) {
                reportError("Google Gemini Provider API", data.error.message || JSON.stringify(data.error));
                return null;
            }

            // Save telemetry
            lastResponseMetadata = {
                id: data.candidates?.[0]?.index || null,
                model: model,
                usage: data.usageMetadata ? {
                    prompt_tokens: data.usageMetadata.promptTokenCount || 0,
                    completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
                    total_tokens: data.usageMetadata.totalTokenCount || 0
                } : null,
                cost: null,
                rawResponse: data
            };

            if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
                return data.candidates[0].content.parts[0].text;
            }

            return null;
        } catch (error) {
            console.error("❌ [GeminiProvider] Error:", error.message);
            addLog("خطأ في الاتصال بـ Google Gemini");
            return null;
        }
    }
}

/**
 * Ollama Provider Implementation
 */
class OllamaProvider extends AIProvider {
    async generate(messages, options = {}) {
        try {
            const apiBase = this.baseUrl || "http://127.0.0.1:11434";
            const url = `${apiBase}/api/chat`;
            const model = this.model || "llama3";
            const temp = parseFloat(process.env.AI_TEMPERATURE || "0.2");

            // Logging and assertion before every request
            console.log(`[AI Request Prep]
Selected Provider: ollama
Selected Model: ${model}
HTTP Endpoint: ${url}
Adapter Used: OllamaProvider`);

            if (this.constructor.name !== 'OllamaProvider') {
                throw new Error(`Configuration Error: Adapter mismatch inside OllamaProvider. Found: ${this.constructor.name}`);
            }

            let finalMessages = [...messages];
            if (options.media) {
                const { convertImageToBase64 } = require('../utils/imageHelper');
                const base64Url = convertImageToBase64(options.media);
                if (base64Url && finalMessages.length > 0) {
                    const lastMsgIdx = finalMessages.length - 1;
                    const lastMsg = finalMessages[lastMsgIdx];
                    if (lastMsg.role === 'user') {
                        const rawBase64 = base64Url.split(';base64,').pop();
                        finalMessages[lastMsgIdx] = {
                            ...lastMsg,
                            images: [rawBase64]
                        };
                    }
                }
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    messages: finalMessages,
                    stream: false,
                    options: {
                        temperature: temp
                    }
                })
            });

            const data = await response.json();

            if (data.error) {
                reportError("Ollama Provider API", data.error);
                return null;
            }

            // Save telemetry
            lastResponseMetadata = {
                id: null,
                model: data.model || model,
                usage: {
                    prompt_tokens: data.prompt_eval_count || 0,
                    completion_tokens: data.eval_count || 0,
                    total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
                },
                cost: 0.0,
                rawResponse: data
            };

            if (data.message) {
                return data.message.content;
            }

            return null;
        } catch (error) {
            console.error("❌ [OllamaProvider] Error:", error.message);
            addLog("خطأ في الاتصال بـ Ollama المحلي");
            return null;
        }
    }
}

/**
 * Helper to validate provider and model combinations.
 */
function validateProviderModelCombination(provider, model) {
    if (!provider || !model) return;
    const prov = provider.toLowerCase().trim();
    const mdl = model.toLowerCase().trim();

    if (prov === 'gemini') {
        // Gemini: Allowed models: gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash, gemini-1.5-flash, etc.
        if (mdl.includes('/') || !mdl.startsWith('gemini-')) {
            throw new Error(`Configuration Error: Model "${model}" is invalid for provider "gemini". Gemini models must start with "gemini-" and must not contain any slashes.`);
        }
    } else if (prov === 'openai') {
        // OpenAI: Allowed models: gpt-*, o1-*, whisper-*, tts-*, text-*
        if (mdl.includes('/') || (!mdl.startsWith('gpt-') && !mdl.startsWith('o1-') && !mdl.startsWith('whisper-') && !mdl.startsWith('tts-') && !mdl.startsWith('text-'))) {
            throw new Error(`Configuration Error: Model "${model}" is invalid for provider "openai". OpenAI models must start with gpt-, o1-, whisper-, tts-, etc., and must not contain any slashes.`);
        }
    } else if (prov === 'openrouter') {
        // OpenRouter: Must contain a slash indicating author/namespace, e.g., deepseek/deepseek-chat
        if (!mdl.includes('/')) {
            throw new Error(`Configuration Error: Model "${model}" is invalid for provider "openrouter". OpenRouter models must contain a slash (e.g. "deepseek/deepseek-chat").`);
        }
    } else if (prov === 'anthropic') {
        // Anthropic: Must start with claude- and not contain any slash
        if (mdl.includes('/') || !mdl.startsWith('claude-')) {
            throw new Error(`Configuration Error: Model "${model}" is invalid for provider "anthropic". Anthropic models must start with "claude-" and must not contain any slashes.`);
        }
    }
}

/**
 * Factory resolver for resolving configured AI Provider.
 * Safely falls back to current OpenRouter setup for 100% backward compatibility.
 */
function getAIProvider() {
    const providerKey = (process.env.AI_PROVIDER || 'openrouter').toLowerCase().trim();
    const model = process.env.AI_MODEL || process.env.OPENROUTER_MODEL || "openrouter/free";
    const apiKey = process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY;
    const baseUrl = process.env.AI_BASE_URL;

    // Enforce combination validation
    validateProviderModelCombination(providerKey, model);

    let providerInstance;
    switch (providerKey) {
        case 'openai':
            providerInstance = new OpenAIProvider(model, apiKey, baseUrl);
            break;
        case 'gemini':
            providerInstance = new GeminiProvider(model, apiKey, baseUrl);
            break;
        case 'ollama':
            providerInstance = new OllamaProvider(model, apiKey, baseUrl || "http://127.0.0.1:11434");
            break;
        case 'openrouter':
        default:
            providerInstance = new OpenRouterProvider(model, apiKey, baseUrl || "https://openrouter.ai/v1");
            break;
    }

    // Verify that the adapter matches the selected provider
    const expectedAdapterName = providerKey === 'openai' ? 'OpenAIProvider' :
                                providerKey === 'gemini' ? 'GeminiProvider' :
                                providerKey === 'ollama' ? 'OllamaProvider' :
                                'OpenRouterProvider';
    if (providerInstance.constructor.name !== expectedAdapterName) {
        throw new Error(`Configuration Error: Adapter mismatch. Expected "${expectedAdapterName}" but got "${providerInstance.constructor.name}"`);
    }

    return providerInstance;
}

/**
 * Task-Based AI Provider Resolver
 * Dynamically loads configured model/provider per task with full backward-compatibility fallback.
 */
function getAIProviderForTask(taskName) {
    try {
        const { getTaskConfig } = require('../database/repositories/aiTaskRepository');
        const settingsRepository = require('../database/repositories/settingsRepository');

        let config = getTaskConfig(taskName);

        // Backward compatibility fallback
        if (!config) {
            if (taskName === 'text_generation') {
                const providerKey = (process.env.AI_PROVIDER || 'openrouter').toLowerCase().trim();
                const model = process.env.AI_MODEL || process.env.OPENROUTER_MODEL || "openrouter/free";
                const apiKeyRef = providerKey === 'openai' ? 'OPENAI_API_KEY' : (providerKey === 'gemini' ? 'GEMINI_API_KEY' : 'OPENROUTER_API_KEY');
                config = {
                    task: 'text_generation',
                    provider: providerKey,
                    model: model,
                    api_key_ref: apiKeyRef,
                    enabled: 1
                };
            } else {
                const defaults = {
                    vision: { provider: 'openai', model: 'gpt-4o-mini', api_key_ref: 'OPENAI_API_KEY' },
                    speech_to_text: { provider: 'openai', model: 'whisper-1', api_key_ref: 'OPENAI_API_KEY' },
                    text_to_speech: { provider: 'openai', model: 'tts-1', api_key_ref: 'OPENAI_API_KEY' },
                    embedding: { provider: 'ollama', model: 'nomic-embed-text', api_key_ref: '' },
                    reranker: { provider: 'ollama', model: 'bge-reranker-large', api_key_ref: '' }
                };
                const def = defaults[taskName];
                if (def) {
                    config = {
                        task: taskName,
                        provider: def.provider,
                        model: def.model,
                        api_key_ref: def.api_key_ref,
                        enabled: 1
                    };
                }
            }
        }

        if (!config || !config.enabled) {
            return null;
        }

        const providerKey = config.provider.toLowerCase().trim();
        const model = config.model;

        // Enforce combination validation
        validateProviderModelCombination(providerKey, model);

        // Resolve API key reference
        let apiKey = '';
        if (config.api_key_ref) {
            apiKey = process.env[config.api_key_ref] || settingsRepository.getSetting(config.api_key_ref);
        }
        // Fallbacks if not found
        if (!apiKey && providerKey !== 'ollama') {
            apiKey = process.env.AI_API_KEY || settingsRepository.getSetting('AI_API_KEY') ||
                     process.env.OPENROUTER_API_KEY || settingsRepository.getSetting('OPENROUTER_API_KEY');
        }

        const baseUrl = process.env.AI_BASE_URL;

        let providerInstance;
        switch (providerKey) {
            case 'openai':
                providerInstance = new OpenAIProvider(model, apiKey, baseUrl);
                break;
            case 'gemini':
                providerInstance = new GeminiProvider(model, apiKey, baseUrl);
                break;
            case 'ollama':
                const ollamaBaseUrl = settingsRepository.getSetting('OLLAMA_BASE_URL') || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
                providerInstance = new OllamaProvider(model, apiKey, ollamaBaseUrl);
                break;
            case 'openrouter':
            default:
                providerInstance = new OpenRouterProvider(model, apiKey, baseUrl || "https://openrouter.ai/api/v1");
                break;
        }

        // Verify that the adapter matches the selected provider
        const expectedAdapterName = providerKey === 'openai' ? 'OpenAIProvider' :
                                    providerKey === 'gemini' ? 'GeminiProvider' :
                                    providerKey === 'ollama' ? 'OllamaProvider' :
                                    'OpenRouterProvider';
        if (providerInstance.constructor.name !== expectedAdapterName) {
            throw new Error(`Configuration Error: Adapter mismatch. Expected "${expectedAdapterName}" but got "${providerInstance.constructor.name}"`);
        }

        return providerInstance;
    } catch (err) {
        console.error(`Error resolving provider for task ${taskName}:`, err.message);
        throw err; // Propagate validation/configuration errors cleanly
    }
}

module.exports = {
    AIProvider,
    OpenRouterProvider,
    OpenAIProvider,
    GeminiProvider,
    OllamaProvider,
    getAIProvider,
    getAIProviderForTask,
    getLastResponseMetadata
};
