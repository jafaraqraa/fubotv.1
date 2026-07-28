// AI Models Management Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.aimodels = {
    tasksMetadata: {
        'text_generation': { title: "توليد النصوص (Text Generation)", icon: "📝", desc: "نموذج توليد وتطوير الردود النصية وإجراء المحادثات الذكية." },
        'vision': { title: "الرؤية البصرية (Vision - Images)", icon: "👁️", desc: "تحليل وفهم الصور والمستندات المصورة (مستقبلي)." },
        'speech_to_text': { title: "تحويل الصوت إلى نص (Speech To Text)", icon: "🎙️", desc: "نموذج التعرف التلقائي على الكلام وتحويل الصوت إلى نص مكتوب (مستقبلي)." },
        'text_to_speech': { title: "تحويل النص إلى صوت (Text To Speech)", icon: "🔊", desc: "نموذج توليد ومحاكاة النطق البشري الذكي من النصوص (مستقبلي)." },
        'embedding': { title: "نموذج الترميز (Embedding Model)", icon: "🔢", desc: "توليد المتجهات الرقمية للفقرات والنصوص لتشغيل البحث الدلالي المتجهي." },
        'reranker': { title: "إعادة الترتيب (Reranker)", icon: "📊", desc: "نموذج إعادة ترتيب نتائج البحث وتصنيفها لتوفير أعلى دقة للـ RAG." }
    },

    standardModels: {
        'openrouter': [
            { id: 'openrouter/free', name: 'Auto Router (Standard)' },
            { id: 'openai/gpt-5', name: 'GPT-5' },
            { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
            { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (Professional)' }
        ],
        'openai': [
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
            { id: 'gpt-4.1', name: 'GPT-4.1' },
            { id: 'whisper-1', name: 'Whisper 1 (Speech-To-Text)' },
            { id: 'tts-1', name: 'TTS 1 (Text-To-Speech)' }
        ],
        'gemini': [
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' }
        ],
        'ollama': [
            { id: 'llama3', name: 'Llama 3 (Local)' },
            { id: 'nomic-embed-text', name: 'Nomic Embed Text (Local)' },
            { id: 'bge-reranker-large', name: 'BGE Reranker Large (Local)' }
        ]
    },

    init: async function() {
        console.log("🤖 Initializing AI Models Module...");
        // Ensure custom models are parsed and loaded if available
        if ((!window.Dashboard.state.customModels || window.Dashboard.state.customModels.length === 0) && window.Dashboard.state.settings && window.Dashboard.state.settings.aiCustomModels) {
            try {
                const parsed = JSON.parse(window.Dashboard.state.settings.aiCustomModels);
                if (parsed && typeof parsed === 'object' && parsed.models) {
                    window.Dashboard.state.customModels = parsed.models;
                    window.Dashboard.state.customModelsTimestamp = parsed.updatedAt || 0;
                } else if (Array.isArray(parsed)) {
                    window.Dashboard.state.customModels = parsed;
                    window.Dashboard.state.customModelsTimestamp = 0;
                }
            } catch (e) {
                console.warn("Failed to parse custom models from settings:", e);
                window.Dashboard.state.customModels = [];
            }
        }
        await this.loadTasks();
    },

    loadTasks: async function() {
        const grid = document.getElementById('ai-tasks-grid');
        if (!grid) return;

        grid.innerHTML = `
            <div class="col-span-full text-center py-12 text-slate-400">
                <i class="fa fa-spinner fa-spin text-xl mb-2"></i>
                <p class="text-xs">جاري تحميل مهام وموديلات الذكاء الاصطناعي...</p>
            </div>
        `;

        try {
            const response = await window.Dashboard.api.request('/api/ai-tasks');
            const data = await response.json();

            if (!data.success) {
                grid.innerHTML = `<div class="col-span-full text-center py-6 text-red-500 text-xs">فشل تحميل المهام: ${data.error}</div>`;
                return;
            }

            this.renderTasks(data.tasks);
        } catch (err) {
            console.error("Failed to load AI tasks:", err);
            grid.innerHTML = `<div class="col-span-full text-center py-6 text-red-500 text-xs">خطأ في الاتصال بالسيرفر: ${err.message}</div>`;
        }
    },

    renderTasks: function(tasks) {
        const grid = document.getElementById('ai-tasks-grid');
        if (!grid) return;

        if (!tasks || tasks.length === 0) {
            grid.innerHTML = `<div class="col-span-full text-center py-12 text-slate-400 text-xs">لا توجد مهام ذكية مبرمجة حالياً.</div>`;
            return;
        }

        grid.innerHTML = '';

        tasks.forEach(task => {
            const meta = this.tasksMetadata[task.task] || { title: task.task, icon: "⚙️", desc: "" };

            // Format provider name for beautiful display
            let providerName = "OpenRouter";
            if (task.provider === 'openai') providerName = "OpenAI";
            else if (task.provider === 'gemini') providerName = "Google Gemini";
            else if (task.provider === 'ollama') providerName = "Ollama (محلي)";

            const card = document.createElement('div');
            card.className = "bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between hover:shadow-md transition duration-200";
            card.setAttribute('data-testid', `task-card-${task.task}`);
            card.innerHTML = `
                <div class="space-y-2">
                    <div class="flex items-center gap-3">
                        <span class="text-2xl">${meta.icon}</span>
                        <h3 class="font-bold text-slate-800 text-xs">${meta.title}</h3>
                    </div>
                    <p class="text-[11px] text-slate-400 leading-relaxed">${meta.desc}</p>
                </div>

                <div class="pt-4 border-t border-slate-100 space-y-2 text-xs">
                    <div class="flex justify-between">
                        <span class="text-slate-400">المزود الحالي:</span>
                        <span class="font-bold text-slate-700">${providerName}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-slate-400">الموديل النشط:</span>
                        <span class="font-bold text-indigo-600 font-mono text-[11px] bg-slate-50 px-2 py-0.5 rounded border border-slate-100">${task.model}</span>
                    </div>
                </div>

                <div class="pt-2 flex gap-2">
                    <button onclick="window.Dashboard.aimodels.openChangeModelModal('${task.task}', '${task.provider}', '${task.model}')"
                        data-testid="btn-change-${task.task}"
                        class="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-200 font-bold py-2 px-3 rounded-xl text-xs transition duration-200 flex items-center justify-center gap-1">
                        <i class="fa fa-exchange-alt text-[10px]"></i> تغيير (Change)
                    </button>
                    <button onclick="window.Dashboard.aimodels.openAddCustomModelForTask('${task.task}', '${task.provider}')"
                        data-testid="btn-add-custom-${task.task}"
                        class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 hover:text-indigo-900 border border-indigo-100 font-bold py-2 px-3 rounded-xl text-xs transition duration-200 flex items-center justify-center gap-1">
                        + مخصص (Add Custom)
                    </button>
                </div>
            `;
            grid.appendChild(card);
        });
    },

    openChangeModelModal: async function(taskId, provider, model) {
        const modal = document.getElementById('aimodels-modal');
        if (!modal) return;

        const meta = this.tasksMetadata[taskId] || { title: taskId };
        document.getElementById('aimodels-modal-title').innerText = `تعديل الموديل الذكي لـ ${meta.title}`;
        document.getElementById('aimodels-modal-task-id').value = taskId;
        document.getElementById('aimodels-modal-provider').value = provider;

        // Hide custom fields and clear input on open if they exist
        const customFields = document.getElementById('aimodels-modal-custom-fields');
        if (customFields) customFields.classList.add('hidden');
        const customName = document.getElementById('aimodels-modal-custom-name');
        if (customName) customName.value = '';
        const customId = document.getElementById('aimodels-modal-custom-id');
        if (customId) customId.value = '';

        // Load models list for this provider and set the current active model
        await this.populateModelsDropdown(provider, model);

        modal.classList.remove('hidden');
    },

    populateModelsDropdown: async function(provider, selectedModel = null) {
        const select = document.getElementById('aimodels-modal-model');
        if (!select) return;

        select.innerHTML = '';

        // Load standard models
        const models = [...(this.standardModels[provider] || [])];

        // Load custom models matching this provider from global Dashboard state
        const customList = window.Dashboard.state.customModels || [];
        customList.forEach(m => {
            if (m.provider === provider) {
                // Avoid duplicates in dropdown
                if (!models.some(item => item.id === m.id)) {
                    models.push({ id: m.id, name: `${m.name} (مخصص)` });
                }
            }
        });

        // For Ollama, dynamically query local tags to prefer actual installed models
        if (provider === 'ollama') {
            try {
                const response = await window.Dashboard.api.request('/api/ai/ollama-models');
                const data = await response.json();
                if (data.success && Array.isArray(data.models) && data.models.length > 0) {
                    // Prepend dynamic models to select list
                    data.models.forEach(modelName => {
                        if (!models.some(m => m.id === modelName)) {
                            models.unshift({ id: modelName, name: `${modelName} (محلي)` });
                        }
                    });
                }
            } catch (e) {
                console.warn('Ollama model fetching failed in AI Models:', e);
            }
        }

        // Add to dropdown
        models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.innerText = m.name;
            select.appendChild(opt);
        });

        // Ensure current active model is present and selected
        if (selectedModel) {
            let exists = false;
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].value === selectedModel) {
                    exists = true;
                    break;
                }
            }

            if (!exists) {
                const opt = document.createElement('option');
                opt.value = selectedModel;
                opt.innerText = `${selectedModel} (مخصص)`;
                select.appendChild(opt);
            }

            select.value = selectedModel;
        }

        // Setup Delete Custom Model button check
        const deleteContainer = document.getElementById('aimodels-modal-delete-container');
        if (deleteContainer) {
            const updateDeleteBtnVisibility = () => {
                const val = select.value;
                const isCustom = (window.Dashboard.state.customModels || [])
                    .some(m => m.provider === provider && m.id === val);
                if (isCustom) {
                    deleteContainer.classList.remove('hidden');
                } else {
                    deleteContainer.classList.add('hidden');
                }
            };
            select.onchange = updateDeleteBtnVisibility;
            updateDeleteBtnVisibility();
        }
    }
};

// Global bindings for inline events inside modal
window.hideDeleteCustomModelModal = function() {
    const modal = document.getElementById('delete-custom-model-modal');
    if (modal) modal.classList.add('hidden');
};

window.deleteCustomModelFromModal = async function() {
    const select = document.getElementById('aimodels-modal-model');
    const provider = document.getElementById('aimodels-modal-provider').value;
    if (!select) return;
    await deleteCustomModelFlow(select.value, provider);
};

window.deleteCustomModelFromSettings = async function() {
    const select = document.getElementById('model-select');
    const provider = document.getElementById('ai-provider-select').value;
    if (!select) return;
    await deleteCustomModelFlow(select.value, provider);
};

async function deleteCustomModelFlow(modelId, provider) {
    if (!modelId) return;

    // Check if it's a custom model
    const isCustom = (window.Dashboard.state.customModels || [])
        .some(m => m.provider === provider && m.id === modelId);
    if (!isCustom) {
        alert('يمكن فقط حذف الموديلات المخصصة المنشأة بواسطة المستخدم.');
        return;
    }

    try {
        // 1. Fetch AI task configs to check if model is currently assigned to any task
        const response = await window.Dashboard.api.request('/api/ai-tasks');
        const data = await response.json();

        if (data.success && Array.isArray(data.tasks)) {
            const assignedTasks = data.tasks.filter(
                t => t.provider === provider && t.model === modelId
            );
            if (assignedTasks.length > 0) {
                const taskTitles = assignedTasks.map(t => {
                    const meta = window.Dashboard.aimodels.tasksMetadata[t.task];
                    return meta ? meta.title : t.task;
                });
                alert(`عذراً، هذا النموذج المخصص مستخدم حالياً للمهام التالية: [${taskTitles.join('، ')}].\nيرجى تحديد وتعيين نموذج آخر لهذه المهام قبل حذفه.`);
                return;
            }
        }

        // 2. Show Styled Confirmation Dialog
        const modal = document.getElementById('delete-custom-model-modal');
        const confirmBtn = document.getElementById('delete-custom-model-confirm-btn');
        if (!modal || !confirmBtn) return;

        modal.classList.remove('hidden');

        confirmBtn.onclick = async function() {
            window.hideDeleteCustomModelModal();

            // Filter only the selected provider/model pair. Different providers
            // are allowed to use the same model identifier.
            const previousModels = [...(window.Dashboard.state.customModels || [])];
            window.Dashboard.state.customModels = previousModels.filter(
                m => !(m.provider === provider && m.id === modelId)
            );

            // Construct payload and save
            const now = Date.now();
            window.Dashboard.state.customModelsTimestamp = now;
            const payload = {
                aiCustomModels: JSON.stringify({
                    updatedAt: now,
                    models: window.Dashboard.state.customModels
                })
            };

            try {
                const settingsResponse = await window.Dashboard.api.request('/api/config/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const settingsResult = await settingsResponse.json();

                if (settingsResult.success) {
                    // Update selectors on settings drawer & aimodels modal
                    await window.Dashboard.settings.populateModelsDropdown(provider);
                    if (window.Dashboard.aimodels && window.Dashboard.aimodels.populateModelsDropdown) {
                        await window.Dashboard.aimodels.populateModelsDropdown(provider);
                    }

                    // Re-trigger select change event listeners to update delete containers visibility
                    const selectAimodels = document.getElementById('aimodels-modal-model');
                    if (selectAimodels && typeof selectAimodels.onchange === 'function') {
                        selectAimodels.onchange();
                    }
                    const selectSettings = document.getElementById('model-select');
                    if (selectSettings && typeof selectSettings.onchange === 'function') {
                        selectSettings.onchange();
                    }

                    if (window.Dashboard.settings && window.Dashboard.settings.showToast) {
                        window.Dashboard.settings.showToast('تم حذف النموذج المخصص بنجاح وإزالته من جميع القوائم المتاحة.');
                    } else {
                        alert('تم حذف النموذج المخصص بنجاح!');
                    }
                } else {
                    window.Dashboard.state.customModels = previousModels;
                    alert(`فشل الحفظ بالسيرفر: ${settingsResult.error}`);
                }
            } catch (err) {
                window.Dashboard.state.customModels = previousModels;
                alert(`خطأ في الاتصال: ${err.message}`);
            }
        };

    } catch (err) {
        alert(`حدث خطأ أثناء فحص تعيينات النموذج: ${err.message}`);
    }
}

window.hideAIModelModal = function() {
    const modal = document.getElementById('aimodels-modal');
    if (modal) modal.classList.add('hidden');
};

window.onAIModelProviderChange = async function() {
    const provider = document.getElementById('aimodels-modal-provider').value;
    await window.Dashboard.aimodels.populateModelsDropdown(provider);
};

window.toggleAIModelCustomFields = function() {
    const fields = document.getElementById('aimodels-modal-custom-fields');
    if (fields) {
        fields.classList.toggle('hidden');
    }
};

window.saveAIModelCustomModel = async function() {
    const name = document.getElementById('aimodels-modal-custom-name').value.trim();
    const id = document.getElementById('aimodels-modal-custom-id').value.trim();
    const provider = document.getElementById('aimodels-modal-provider').value;

    if (!name || !id) {
        alert('يرجى إدخال اسم العرض ومعرّف النموذج المخصص.');
        return;
    }

    const isDuplicateCustom = (window.Dashboard.state.customModels || [])
        .some(m => m.provider === provider && m.id === id);
    const isDuplicateStandard = (window.Dashboard.aimodels.standardModels[provider] || [])
        .some(m => m.id === id);
    if (isDuplicateCustom || isDuplicateStandard) {
        alert(`عذراً، هذا المعرّف (${id}) موجود مسبقاً لهذا المزود.`);
        return;
    }

    // Create new timestamp
    const now = Date.now();
    window.Dashboard.state.customModelsTimestamp = now;

    // Add to global state custom models list
    window.Dashboard.state.customModels = window.Dashboard.state.customModels || [];
    window.Dashboard.state.customModels.push({ provider, name, id });

    // Persist immediately in settings database (prevent duplicate configuration)
    try {
        const payload = {
            aiCustomModels: JSON.stringify({
                updatedAt: now,
                models: window.Dashboard.state.customModels
            })
        };
        const response = await window.Dashboard.api.request('/api/config/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (data.success) {
            // Unify state from the server response
            // Fetch updated stats to ensure we strictly sync with the true database state
            const statsResp = await window.Dashboard.api.request('/api/stats');
            const stats = await statsResp.json();
            if (stats.aiCustomModels) {
                const parsed = JSON.parse(stats.aiCustomModels);
                if (parsed && parsed.updatedAt >= window.Dashboard.state.customModelsTimestamp) {
                    window.Dashboard.state.customModels = parsed.models;
                    window.Dashboard.state.customModelsTimestamp = parsed.updatedAt;
                }
            }

            // Re-populate both dropdown panels and auto select the new option
            await window.Dashboard.aimodels.populateModelsDropdown(provider, id);
            if (window.Dashboard.settings && window.Dashboard.settings.populateModelsDropdown) {
                window.Dashboard.state.pendingLoadedModel = id;
                await window.Dashboard.settings.populateModelsDropdown(provider);
            }

            // Hide custom inputs
            document.getElementById('aimodels-modal-custom-fields').classList.add('hidden');
            document.getElementById('aimodels-modal-custom-name').value = '';
            document.getElementById('aimodels-modal-custom-id').value = '';

            alert('تمت إضافة النموذج المخصص وجعله متاحاً للتحديد فوراً!');
        } else {
            window.Dashboard.state.customModels = (window.Dashboard.state.customModels || [])
                .filter(m => !(m.provider === provider && m.id === id));
            alert(`فشل حفظ النموذج المخصص بالسيرفر: ${data.error}`);
        }
    } catch (err) {
        window.Dashboard.state.customModels = (window.Dashboard.state.customModels || [])
            .filter(m => !(m.provider === provider && m.id === id));
        console.error("Failed to persist custom model:", err);
        alert(`خطأ في الاتصال بحفظ النموذج المخصص: ${err.message}`);
    }
};

window.saveAIModelTaskConfig = async function() {
    const task = document.getElementById('aimodels-modal-task-id').value;
    const provider = document.getElementById('aimodels-modal-provider').value;
    const model = document.getElementById('aimodels-modal-model').value;

    if (!model) {
        alert('الرجاء اختيار أو إضافة نموذج للبدء.');
        return;
    }

    // Map standard api key reference
    let apiKeyRef = 'OPENROUTER_API_KEY';
    if (provider === 'openai') {
        apiKeyRef = 'OPENAI_API_KEY';
    } else if (provider === 'gemini') {
        apiKeyRef = 'GEMINI_API_KEY';
    } else if (provider === 'ollama') {
        apiKeyRef = ''; // No API key required
    }

    const payload = {
        task,
        provider,
        model,
        api_key_ref: apiKeyRef,
        enabled: 1
    };

    try {
        const response = await window.Dashboard.api.request('/api/ai-tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (data.success) {
            if (task === 'text_generation') {
                window.Dashboard.state.selectedAiProvider = provider;
                const providerSelect = document.getElementById('ai-provider-select');
                if (providerSelect) providerSelect.value = provider;
            }
            window.hideAIModelModal();
            // Refresh grid
            await window.Dashboard.aimodels.loadTasks();
            alert('تم حفظ إعداد الموديل الذكي للمهمة المحددة بنجاح!');
        } else {
            alert(`فشل الحفظ: ${data.error}`);
        }
    } catch (err) {
        console.error("Failed to save task config:", err);
        alert(`خطأ في الاتصال: ${err.message}`);
    }
};

window.Dashboard.aimodels.openAddCustomModelForTask = function(taskId, currentProvider) {
    const modal = document.getElementById('aimodels-card-custom-modal');
    if (!modal) return;

    document.getElementById('aimodels-card-custom-task-id').value = taskId;
    document.getElementById('aimodels-card-custom-provider').value = currentProvider;
    document.getElementById('aimodels-card-custom-name').value = '';
    document.getElementById('aimodels-card-custom-id').value = '';

    modal.classList.remove('hidden');
};

window.hideAICardCustomModelModal = function() {
    const modal = document.getElementById('aimodels-card-custom-modal');
    if (modal) modal.classList.add('hidden');
};

window.saveAICardCustomModel = async function() {
    const taskId = document.getElementById('aimodels-card-custom-task-id').value;
    const provider = document.getElementById('aimodels-card-custom-provider').value;
    const name = document.getElementById('aimodels-card-custom-name').value.trim();
    const id = document.getElementById('aimodels-card-custom-id').value.trim();

    if (!name || !id) {
        alert('يرجى إدخال اسم العرض ومعرّف النموذج المخصص.');
        return;
    }

    // Prevent duplicate Model IDs for the same provider
    const isDuplicateCustom = (window.Dashboard.state.customModels || []).some(
        m => m.provider === provider && m.id === id
    );
    const standardForProvider = window.Dashboard.aimodels.standardModels[provider] || [];
    const isDuplicateStandard = standardForProvider.some(m => m.id === id);

    if (isDuplicateCustom || isDuplicateStandard) {
        alert(`عذراً، هذا المعرّف (${id}) موجود مسبقاً لهذا المزود (${provider}). يرجى استخدام معرّف فريد.`);
        return;
    }

    // Create new timestamp
    const now = Date.now();
    window.Dashboard.state.customModelsTimestamp = now;

    // Add to state list
    window.Dashboard.state.customModels = window.Dashboard.state.customModels || [];
    window.Dashboard.state.customModels.push({ provider, name, id });

    try {
        // 1. Save the custom model to the database
        const settingsPayload = {
            aiCustomModels: JSON.stringify({
                updatedAt: now,
                models: window.Dashboard.state.customModels
            })
        };
        const settingsResponse = await window.Dashboard.api.request('/api/config/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settingsPayload)
        });
        const settingsResult = await settingsResponse.json();

        if (!settingsResult.success) {
            alert(`فشل حفظ النموذج المخصص بالسيرفر: ${settingsResult.error}`);
            return;
        }

        // Fetch updated stats to ensure synchronization with true database state
        const statsResp = await window.Dashboard.api.request('/api/stats');
        const stats = await statsResp.json();
        if (stats.aiCustomModels) {
            const parsed = JSON.parse(stats.aiCustomModels);
            if (parsed && parsed.updatedAt >= window.Dashboard.state.customModelsTimestamp) {
                window.Dashboard.state.customModels = parsed.models;
                window.Dashboard.state.customModelsTimestamp = parsed.updatedAt;
            }
        }

        // 2. Automatically assign and save this new model on the active task
        let apiKeyRef = 'OPENROUTER_API_KEY';
        if (provider === 'openai') {
            apiKeyRef = 'OPENAI_API_KEY';
        } else if (provider === 'gemini') {
            apiKeyRef = 'GEMINI_API_KEY';
        } else if (provider === 'ollama') {
            apiKeyRef = ''; // No API key required
        }

        const taskPayload = {
            task: taskId,
            provider,
            model: id,
            api_key_ref: apiKeyRef,
            enabled: 1
        };

        const taskResponse = await window.Dashboard.api.request('/api/ai-tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(taskPayload)
        });
        const taskResult = await taskResponse.json();

        if (taskResult.success) {
            if (taskId === 'text_generation') {
                window.Dashboard.state.selectedAiProvider = provider;
                const providerSelect = document.getElementById('ai-provider-select');
                if (providerSelect) providerSelect.value = provider;
            }
            // Hide the modal
            window.hideAICardCustomModelModal();

            // Refresh the grid
            await window.Dashboard.aimodels.loadTasks();

            // Also refresh Settings model dropdowns so it appears anywhere else in the application
            if (window.Dashboard.settings && window.Dashboard.settings.populateModelsDropdown) {
                window.Dashboard.state.pendingLoadedModel = id;
                await window.Dashboard.settings.populateModelsDropdown(provider);
            }

            alert('تمت إضافة النموذج المخصص وتعيينه بنجاح لهذه المهمة دون الحاجة لإعادة تحميل الصفحة!');
        } else {
            alert(`فشل تعيين النموذج للمهمة: ${taskResult.error}`);
        }
    } catch (err) {
        console.error("Failed to complete save flow for custom model:", err);
        alert(`خطأ في الاتصال أثناء حفظ الموديل: ${err.message}`);
    }
};
