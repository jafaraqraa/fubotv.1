// Dashboard Settings, RAG Knowledge Base, and Settings Drawer Module
window.Dashboard = window.Dashboard || {};

// Add more properties to state for drawer & dirty checking tracking
window.Dashboard.state.drawerOpen = false;
window.Dashboard.state.activeDrawerForm = null;
window.Dashboard.state.originalFormValues = {};
window.Dashboard.state.isSaving = false;

window.Dashboard.settings = {
    // 1. Top-Center Toast notifications matching visual source of truth
    showToast: function(message, type = 'success') {
        const container = document.getElementById('futh-toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `futh-toast ${type}`;

        let iconMarkup = '';
        if (type === 'success') {
            iconMarkup = `<svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
        } else {
            iconMarkup = `<svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
        }

        toast.innerHTML = `
            <div class="flex-shrink-0">${iconMarkup}</div>
            <div class="flex flex-col">
                <div class="text-xs font-bold text-slate-800">${type === 'success' ? 'تم حفظ الإعدادات بنجاح' : 'حدث خطأ أثناء الحفظ'}</div>
                <div class="text-[10px] text-slate-500 mt-0.5">${message}</div>
            </div>
        `;

        container.appendChild(toast);

        // Animate in
        setTimeout(() => {
            toast.classList.add('active');
        }, 10);

        // Animate out and remove
        setTimeout(() => {
            toast.classList.remove('active');
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, 4000);
    },

    // 2. Open Settings Drawer
    openSettingsDrawer: function(formType) {
        // Guard if we already have an active form open with dirty changes
        if (window.Dashboard.state.drawerOpen && window.Dashboard.state.activeDrawerForm !== formType) {
            if (window.Dashboard.settings.checkFormDirty()) {
                window.Dashboard.state.navigationPendingFormType = formType;
                window.Dashboard.settings.showUnsavedConfirmation();
                return;
            }
        }

        const backdrop = document.getElementById('settings-drawer-backdrop');
        const drawer = document.getElementById('settings-drawer');
        const iconContainer = document.getElementById('drawer-header-icon');
        const titleEl = document.getElementById('drawer-title');
        const descEl = document.getElementById('drawer-desc');

        if (!backdrop || !drawer) return;

        // Hide all drawer forms
        document.querySelectorAll('.drawer-form').forEach(el => el.classList.add('hidden'));

        // Show selected form
        const targetForm = document.getElementById(`form-${formType}`);
        if (!targetForm) return;
        targetForm.classList.remove('hidden');

        // Populate drawer header based on service type
        let title = '';
        let desc = '';
        let iconHTML = '';

        switch (formType) {
            case 'ai':
                title = 'إعدادات الذكاء الاصطناعي';
                desc = 'إعداد النموذج والتعليمات وسلوك المساعد المطور';
                iconHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>`;
                break;
            case 'telegram':
                title = 'إعدادات تيليجرام';
                desc = 'ربط وتفعيل البوت وحسابات الإرسال الذاتي للتقارير';
                iconHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>`;
                break;
            case 'whatsapp':
                title = 'إعدادات واتساب ويب';
                desc = 'تخصيص ردود واتساب ويب التلقائية والاتصال';
                iconHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>`;
                break;
            case 'messenger':
                title = 'إعدادات فيسبوك ماسنجر';
                desc = 'مزامنة مفتاح صفحة فيسبوك وتفعيل الرد التلقائي للزبائن';
                iconHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"></path></svg>`;
                break;
            case 'instagram':
                title = 'إعدادات إنستغرام';
                desc = 'ربط حساب إنستغرام للأعمال بالتوكن والرد المساعد';
                iconHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>`;
                break;
            case 'meta':
                title = 'إعدادات Meta Webhook';
                desc = 'مفاتيح ومصادقة التحقق Webhooks الخاص بـ Meta للربط الذاتي';
                iconHTML = `<div class="font-bold text-sm">M</div>`;
                break;
            case 'general':
                title = 'إعدادات النظام العامة';
                desc = 'إعدادات الأمان، تغيير كلمة المرور للمشرف، والمزيد';
                iconHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>`;
                break;
        }

        if (iconContainer) iconContainer.innerHTML = iconHTML;
        if (titleEl) titleEl.innerText = title;
        if (descEl) descEl.innerText = desc;

        // Activate drawer layout
        backdrop.classList.add('active');
        drawer.classList.add('active');
        document.body.classList.add('overflow-hidden-drawer');

        window.Dashboard.state.drawerOpen = true;
        window.Dashboard.state.activeDrawerForm = formType;

        // Remember initial states of all fields for dirty checking
        window.Dashboard.settings.recordInitialFormValues(formType);

        // Bind change/input listeners for settings UX (floating bar)
        const inputs = targetForm.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            const handler = () => {
                const isDirty = window.Dashboard.settings.checkFormDirty();
                if (isDirty) {
                    const sectionNameAr = {
                        'ai': 'إعدادات الذكاء الاصطناعي',
                        'telegram': 'إعدادات تيليجرام',
                        'whatsapp': 'إعدادات واتساب',
                        'messenger': 'إعدادات فيسبوك ماسنجر',
                        'instagram': 'إعدادات إنستغرام',
                        'meta': 'إعدادات Meta Webhook',
                        'general': 'إعدادات المشرف العامة'
                    }[formType] || 'هذا القسم';

                    if (window.Dashboard.rag && window.Dashboard.rag.showFloatingBar) {
                        window.Dashboard.rag.showFloatingBar(`لديك تعديلات غير محفوظة في قسم [${sectionNameAr}].`);

                        // Bind floating bar buttons
                        const saveBtn = document.getElementById('general-floating-save-btn');
                        const discardBtn = document.getElementById('general-floating-discard-btn');

                        if (saveBtn) {
                            saveBtn.onclick = async function() {
                                await window.Dashboard.settings.handleDrawerSaveBtn();
                                window.Dashboard.rag.hideFloatingBar();
                            };
                        }
                        if (discardBtn) {
                            discardBtn.onclick = function() {
                                window.Dashboard.settings.discardDrawerChanges();
                                window.Dashboard.rag.hideFloatingBar();
                            };
                        }
                    }
                } else {
                    if (window.Dashboard.rag && window.Dashboard.rag.hideFloatingBar) {
                        window.Dashboard.rag.hideFloatingBar();
                    }
                }
            };
            input.addEventListener('input', handler);
            input.addEventListener('change', handler);
        });
    },

    // 3. Record initial form values
    recordInitialFormValues: function(formType) {
        window.Dashboard.state.originalFormValues = {};
        const container = document.getElementById(`form-${formType}`);
        if (!container) return;

        const inputs = container.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            if (input.id) {
                window.Dashboard.state.originalFormValues[input.id] = input.value;
            }
        });
    },

    // 4. Dirty tracking: Check if any fields were modified
    checkFormDirty: function() {
        const formType = window.Dashboard.state.activeDrawerForm;
        if (!formType) return false;

        const container = document.getElementById(`form-${formType}`);
        if (!container) return false;

        const inputs = container.querySelectorAll('input, select, textarea');
        let isDirty = false;

        inputs.forEach(input => {
            if (input.id && window.Dashboard.state.originalFormValues[input.id] !== undefined) {
                if (input.value !== window.Dashboard.state.originalFormValues[input.id]) {
                    isDirty = true;
                }
            }
        });

        return isDirty;
    },

    // 5. Close settings drawer with verification
    closeSettingsDrawer: function(forceClose = false) {
        if (!window.Dashboard.state.drawerOpen) return;

        if (!forceClose && window.Dashboard.settings.checkFormDirty()) {
            window.Dashboard.state.navigationPendingFormType = null; // No secondary form transition
            window.Dashboard.settings.showUnsavedConfirmation();
            return;
        }

        const backdrop = document.getElementById('settings-drawer-backdrop');
        const drawer = document.getElementById('settings-drawer');

        if (backdrop) backdrop.classList.remove('active');
        if (drawer) drawer.classList.remove('active');
        document.body.classList.remove('overflow-hidden-drawer');

        window.Dashboard.state.drawerOpen = false;
        window.Dashboard.state.activeDrawerForm = null;
        window.Dashboard.state.originalFormValues = {};

        // Hide floating bar if closed
        if (window.Dashboard.rag && window.Dashboard.rag.hideFloatingBar) {
            window.Dashboard.rag.hideFloatingBar();
        }
    },

    discardDrawerChanges: function() {
        const formType = window.Dashboard.state.activeDrawerForm;
        if (!formType) return;

        const container = document.getElementById(`form-${formType}`);
        if (!container) return;

        const inputs = container.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            if (input.id && window.Dashboard.state.originalFormValues[input.id] !== undefined) {
                input.value = window.Dashboard.state.originalFormValues[input.id];
            }
        });

        window.Dashboard.settings.showToast('تم إلغاء وتجاهل التغييرات بنجاح.');
    },

    // 6. Modal confirmations for unsaved changes
    showUnsavedConfirmation: function() {
        const modal = document.getElementById('unsaved-modal');
        if (modal) modal.classList.add('active');
    },

    dismissUnsavedConfirmation: function() {
        const modal = document.getElementById('unsaved-modal');
        if (modal) modal.classList.remove('active');
        window.Dashboard.state.navigationPendingFormType = null;
    },

    confirmDiscardChanges: function() {
        const modal = document.getElementById('unsaved-modal');
        if (modal) modal.classList.remove('active');

        // Force close active drawer and open pending drawer if requested
        const pendingType = window.Dashboard.state.navigationPendingFormType;
        window.Dashboard.settings.closeSettingsDrawer(true);

        if (pendingType) {
            setTimeout(() => {
                window.Dashboard.settings.openSettingsDrawer(pendingType);
            }, 300);
        }
    },

    // 7. Save Knowledge Base
    saveKnowledgeBase: async function() {
        const input = document.getElementById('knowledge-input');
        if (!input) return;
        const text = input.value.trim();

        const btn = document.getElementById('drawer-save-btn');
        let originalBtnHTML = '';

        if (btn) {
            originalBtnHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `<span class="futh-spinner"></span> <span>جارٍ الحفظ...</span>`;
        }

        window.Dashboard.state.isSaving = true;

        try {
            const response = await window.Dashboard.api.request('/api/config/knowledge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            const result = await response.json();

            if (result.success) {
                window.Dashboard.settings.showToast('تم تحديث إعدادات القناة وسياق معلومات قاعدة المعرفة بنجاح.');
                window.Dashboard.state.isKnowledgeLoaded = false;

                // Record new saved values to state
                window.Dashboard.settings.recordInitialFormValues('knowledge');

                // Update cards status dynamically
                window.Dashboard.settings.updateCardBadges();
                window.Dashboard.analytics.fetchStatsAndUsers();
            } else {
                window.Dashboard.settings.showToast('خطأ: ' + result.error, 'error');
            }
        } catch (err) {
            window.Dashboard.settings.showToast('حدث خطأ بالاتصال بالخادم لحفظ المعرفة.', 'error');
        } finally {
            window.Dashboard.state.isSaving = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalBtnHTML;
            }
        }
    },

    // 8. Save New Settings Payload central integration
    saveNewSettingsPayload: async function(payload, type) {
        const btn = document.getElementById('drawer-save-btn');
        let originalBtnHTML = '';

        if (btn) {
            originalBtnHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `<span class="futh-spinner"></span> <span>جارٍ الحفظ...</span>`;
        }

        window.Dashboard.state.isSaving = true;

        try {
            const response = await window.Dashboard.api.request('/api/config/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.success) {
                window.Dashboard.settings.showToast('تم تحديث إعدادات القناة وتفاصيل الربط بنجاح.');

                if (type === 'telegram') {
                    window.Dashboard.state.isAdminIdLoaded = false;
                    window.Dashboard.state.isTelegramTokenLoaded = false;
                }
                if (type === 'ai') {
                    window.Dashboard.state.isModelLoaded = false;
                    window.Dashboard.state.isPromptLoaded = false;
                    window.Dashboard.state.isOpenRouterLoaded = false;
                }
                if (type === 'messenger') {
                    window.Dashboard.state.isMessengerLoaded = false;
                    window.Dashboard.state.isMessengerAutoReplyLoaded = false;
                }
                if (type === 'instagram') {
                    window.Dashboard.state.isInstagramLoaded = false;
                    window.Dashboard.state.isInstagramAutoReplyLoaded = false;
                }
                if (type === 'meta') {
                    window.Dashboard.state.isMetaVerifyLoaded = false;
                }
                if (type === 'whatsapp') {
                    window.Dashboard.state.isWaAutoReplyLoaded = false;
                }
                if (type === 'rag-settings') {
                    window.Dashboard.state.isRagChunkSizeLoaded = false;
                    window.Dashboard.state.isRagChunkOverlapLoaded = false;
                    window.Dashboard.state.isRagEmbeddingModelLoaded = false;
                    window.Dashboard.state.isQdrantCollectionLoaded = false;
                    window.Dashboard.state.isQdrantUrlLoaded = false;
                    window.Dashboard.state.isOllamaBaseUrlLoaded = false;
                    window.Dashboard.state.isRagIndexOnStartupLoaded = false;
                    window.Dashboard.state.isRagLegacyFallbackLoaded = false;

                    window.Dashboard.state.isRagNeighborExpansionLoaded = false;
                    window.Dashboard.state.isRagContextBudgetLoaded = false;
                    window.Dashboard.state.isRagMinTopKLoaded = false;
                    window.Dashboard.state.isRagDefaultTopKLoaded = false;
                    window.Dashboard.state.isRagMaxTopKLoaded = false;
                    window.Dashboard.state.isRagCandidateMultiplierLoaded = false;
                    window.Dashboard.state.isRagSemanticWeightLoaded = false;
                    window.Dashboard.state.isRagKeywordWeightLoaded = false;
                    window.Dashboard.state.isRagSimilarityThresholdLoaded = false;
                }

                // Close confirmation modal
                window.Dashboard.conversationControls.closeConfirmModal();

                // Save initial form values to avoid unsaved warning
                window.Dashboard.settings.recordInitialFormValues(type);

                // Re-fetch statistics and update badges
                window.Dashboard.settings.updateCardBadges();
                window.Dashboard.analytics.fetchStatsAndUsers();
            } else {
                window.Dashboard.settings.showToast('خطأ: ' + result.error, 'error');
            }
        } catch (err) {
            window.Dashboard.settings.showToast('فشل حفظ وتحديث الإعدادات.', 'error');
        } finally {
            window.Dashboard.state.isSaving = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalBtnHTML;
            }
        }
    },

    executeSaveSettings: async function() {
        const payload = window.Dashboard.state.pendingSettingsPayload;
        const type = window.Dashboard.state.pendingSettingsType;
        if (!payload) return;
        await window.Dashboard.settings.saveNewSettingsPayload(payload, type);
    },

    submitAISettings: function() {
        const openrouterKey = document.getElementById('openrouter-input').value.trim();
        const model = document.getElementById('model-select').value;
        const systemPrompt = document.getElementById('prompt-input').value.trim();

        const aiProvider = document.getElementById('ai-provider-select').value;
        const aiBaseUrl = document.getElementById('ai-base-url-input').value.trim();
        const aiCustomModels = JSON.stringify(window.Dashboard.state.customModels || []);

        // Budgets extraction
        const budgetOpenrouter = parseFloat(document.getElementById('budget-openrouter-input').value) || 100.0;
        const budgetOpenai = parseFloat(document.getElementById('budget-openai-input').value) || 100.0;
        const budgetGemini = parseFloat(document.getElementById('budget-gemini-input').value) || 100.0;
        const budgetOllama = parseFloat(document.getElementById('budget-ollama-input').value) || 100.0;

        window.Dashboard.conversationControls.openSettingsConfirmModal(
            'ai',
            {
                openrouterKey,
                model,
                systemPrompt,
                aiProvider,
                aiModel: model,
                aiApiKey: openrouterKey,
                aiBaseUrl,
                aiCustomModels,
                budgetOpenrouter,
                budgetOpenai,
                budgetGemini,
                budgetOllama
            },
            'تأكيد حفظ الذكاء الاصطناعي؟',
            'سيتم تحديث مفتاح الاتصال ونموذج الذكاء ولغة وسلوك البوت المطور وميزانيات الموديلات.',
            'AI',
            'bg-slate-900 hover:bg-slate-950'
        );
    },

    submitTelegramSettings: function() {
        const token = document.getElementById('token-input').value.trim();
        const adminId = document.getElementById('admin-id-input').value.trim();

        window.Dashboard.conversationControls.openSettingsConfirmModal(
            'telegram',
            { token, adminId },
            'تأكيد مزامنة تيليجرام؟',
            'تحديث توكن الاتصال ومعرف المشرف الخاص بقناة تيليجرام.',
            'TG',
            'bg-blue-600 hover:bg-blue-700'
        );
    },

    submitWhatsAppSettings: function() {
        const waAutoReply = document.getElementById('wa-autoreply-select').value;

        window.Dashboard.conversationControls.openSettingsConfirmModal(
            'whatsapp',
            { waAutoReply },
            'تحديث إعدادات واتساب؟',
            'سيتم تغيير حالة الرد الآلي للعملاء عبر قناة واتساب المربوطة.',
            'WA',
            'bg-slate-800 hover:bg-slate-900'
        );
    },

    submitMessengerSettings: function() {
        const messengerAutoReply = document.getElementById('messenger-autoreply-select').value;
        const messengerToken = document.getElementById('messenger-token-input').value.trim();

        window.Dashboard.conversationControls.openSettingsConfirmModal(
            'messenger',
            { messengerAutoReply, messengerToken },
            'مزامنة فيسبوك ماسنجر؟',
            'سيتم تحديث توكن الصفحة وتفعيل الرد الآلي في قنوات الدعم المباشرة لفيسبوك.',
            'FB',
            'bg-slate-800 hover:bg-slate-900'
        );
    },

    submitInstagramSettings: function() {
        const instagramAutoReply = document.getElementById('instagram-autoreply-select').value;
        const instagramToken = document.getElementById('instagram-token-input').value.trim();

        window.Dashboard.conversationControls.openSettingsConfirmModal(
            'instagram',
            { instagramAutoReply, instagramToken },
            'مزامنة قناة إنستغرام؟',
            'سيتم تحديث توكن الاتصال وسلوك المحادثات التلقائية لحساب إنستغرام للأعمال.',
            'IG',
            'bg-slate-800 hover:bg-slate-900'
        );
    },

    submitMetaVerifySettings: function() {
        const metaVerifyToken = document.getElementById('meta-verify-input').value.trim();

        window.Dashboard.conversationControls.openSettingsConfirmModal(
            'meta',
            { metaVerifyToken },
            'مزامنة Webhook؟',
            'تحديث توكن المصافحة لتأكيد وتوثيق طلبات Meta Webhook المباشرة.',
            'WEBHOOK',
            'bg-slate-850 hover:bg-slate-950'
        );
    },

    // Password change integration
    submitPasswordChange: async function() {
        const currentPassword = document.getElementById('change-pwd-current').value;
        const newPassword = document.getElementById('change-pwd-new').value;

        if (!currentPassword || !newPassword) {
            window.Dashboard.settings.showToast('يرجى ملء جميع الحقول المطلوبة.', 'error');
            return;
        }

        const btn = document.getElementById('drawer-save-btn');
        let originalBtnHTML = '';

        if (btn) {
            originalBtnHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `<span class="futh-spinner"></span> <span>جاري التحديث...</span>`;
        }

        window.Dashboard.state.isSaving = true;

        try {
            const response = await window.Dashboard.api.request('/api/auth/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword })
            });
            const result = await response.json();

            if (result.success) {
                window.Dashboard.settings.showToast('تمت إعادة تعيين كلمة المرور بنجاح.');
                document.getElementById('change-pwd-current').value = '';
                document.getElementById('change-pwd-new').value = '';

                // Record cleared states
                window.Dashboard.settings.recordInitialFormValues('general');
            } else {
                window.Dashboard.settings.showToast('خطأ: ' + (result.error || 'فشل التحديث'), 'error');
            }
        } catch (err) {
            window.Dashboard.settings.showToast('فشل الاتصال لتحديث كلمة المرور.', 'error');
        } finally {
            window.Dashboard.state.isSaving = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalBtnHTML;
            }
        }
    },

    // 9. Dynamic cards status derived from true state configuration
    updateCardBadges: async function() {
        try {
            // Get stats
            const statsResponse = await window.Dashboard.api.request('/api/stats');
            const stats = await statsResponse.json();

            // Get WhatsApp status
            const waResponse = await window.Dashboard.api.request('/api/whatsapp/status');
            const waData = await waResponse.json();

            const badgeAI = document.getElementById('badge-ai');
            const badgeKnowledge = document.getElementById('badge-knowledge');
            const badgeTelegram = document.getElementById('badge-telegram');
            const badgeWhatsApp = document.getElementById('badge-whatsapp');
            const badgeMessenger = document.getElementById('badge-messenger');
            const badgeInstagram = document.getElementById('badge-instagram');
            const badgeMeta = document.getElementById('badge-meta');
            const badgeGeneral = document.getElementById('badge-general');

            const aiStatusDot = document.getElementById('ai-status-dot');

            // 1. AI Status
            if (badgeAI) {
                if (stats.isOpenRouterConfigured) {
                    badgeAI.innerText = 'متصل';
                    badgeAI.className = 'badge-status active';
                    if (aiStatusDot) aiStatusDot.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
                } else {
                    badgeAI.innerText = 'يحتاج إعداد';
                    badgeAI.className = 'badge-status warning';
                    if (aiStatusDot) aiStatusDot.className = 'w-2.5 h-2.5 rounded-full bg-yellow-500';
                }
            }

            // 2. Knowledge base status
            if (badgeKnowledge) {
                if (stats.knowledgeText && stats.knowledgeText.trim() !== '') {
                    badgeKnowledge.innerText = 'مفعّل';
                    badgeKnowledge.className = 'badge-status active';
                } else {
                    badgeKnowledge.innerText = 'يحتاج إعداد';
                    badgeKnowledge.className = 'badge-status warning';
                }
            }

            // 3. Telegram
            if (badgeTelegram) {
                if (stats.isTelegramConfigured) {
                    badgeTelegram.innerText = 'متصل';
                    badgeTelegram.className = 'badge-status active';
                } else {
                    badgeTelegram.innerText = 'غير متصل';
                    badgeTelegram.className = 'badge-status danger';
                }
            }

            // 4. WhatsApp
            if (badgeWhatsApp) {
                if (waData.status === 'متصل') {
                    badgeWhatsApp.innerText = 'متصل';
                    badgeWhatsApp.className = 'badge-status active';
                } else if (waData.status === 'انتظار المسح') {
                    badgeWhatsApp.innerText = 'غير مكتمل';
                    badgeWhatsApp.className = 'badge-status warning';
                } else {
                    badgeWhatsApp.innerText = 'غير متصل';
                    badgeWhatsApp.className = 'badge-status danger';
                }
            }

            // 5. Facebook Messenger
            if (badgeMessenger) {
                if (stats.isMessengerConfigured) {
                    badgeMessenger.innerText = 'متصل';
                    badgeMessenger.className = 'badge-status active';
                } else {
                    badgeMessenger.innerText = 'يحتاج إعداد';
                    badgeMessenger.className = 'badge-status warning';
                }
            }

            // 6. Instagram
            if (badgeInstagram) {
                if (stats.isInstagramConfigured) {
                    badgeInstagram.innerText = 'متصل';
                    badgeInstagram.className = 'badge-status active';
                } else {
                    badgeInstagram.innerText = 'يحتاج إعداد';
                    badgeInstagram.className = 'badge-status warning';
                }
            }

            // 7. Meta Webhook
            if (badgeMeta) {
                if (stats.isMetaVerifyConfigured) {
                    badgeMeta.innerText = 'مفعّل';
                    badgeMeta.className = 'badge-status active';
                } else {
                    badgeMeta.innerText = 'يحتاج إعداد';
                    badgeMeta.className = 'badge-status warning';
                }
            }

            // 8. General Settings
            if (badgeGeneral) {
                badgeGeneral.innerText = 'مفعّل';
                badgeGeneral.className = 'badge-status active';
            }

        } catch (e) {
            console.error('Error updating settings card badges:', e);
        }
    },

    // 10. Utils inside Drawer
    updateCharCounter: function(textarea) {
        const counter = document.getElementById('knowledge-char-counter');
        if (counter) {
            counter.innerText = `${textarea.value.length} حرف`;
        }
    },

    togglePasswordVisibility: function(inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;
        if (input.type === 'password') {
            input.type = 'text';
        } else {
            input.type = 'password';
        }
    },

    copyCallbackUrl: function() {
        const input = document.getElementById('meta-callback-url');
        if (!input) return;
        input.select();
        document.execCommand('copy');
        window.Dashboard.settings.showToast('تم نسخ رابط الـ Webhook بنجاح!');
    },

    handleBackdropClick: function(event) {
        // Prevent action if click propagates from inside the drawer itself
        if (event.target === document.getElementById('settings-drawer-backdrop')) {
            window.Dashboard.settings.closeSettingsDrawer();
        }
    },

    handleDrawerCloseBtn: function() {
        window.Dashboard.settings.closeSettingsDrawer();
    },

    // Drawer footer button handlers
    // Refresh RAG connection and indexing status
    refreshRagStatus: async function() {
        const qStatus = document.getElementById('rag-qdrant-status');
        const oStatus = document.getElementById('rag-ollama-status');
        const mStatus = document.getElementById('rag-model-status');
        const cStatus = document.getElementById('rag-collection-status');
        const rMode = document.getElementById('rag-retrieval-mode');

        const statModel = document.getElementById('rag-stat-model-name');
        const statCollection = document.getElementById('rag-stat-collection-name');
        const statVectors = document.getElementById('rag-stat-vector-count');
        const statSuccess = document.getElementById('rag-stat-last-success');
        const statDuration = document.getElementById('rag-stat-last-duration');

        if (qStatus) qStatus.innerText = 'جاري الفحص...';
        if (oStatus) oStatus.innerText = 'جاري الفحص...';

        try {
            const response = await window.Dashboard.api.request('/api/rag/status');
            const data = await response.json();

            if (data.success && data.status) {
                const s = data.status;

                // Render connection statuses
                if (qStatus) {
                    qStatus.innerText = s.qdrantReachable ? 'متصل' : 'غير متصل';
                    qStatus.className = s.qdrantReachable ? 'font-bold text-green-500' : 'font-bold text-red-500';
                }
                if (oStatus) {
                    oStatus.innerText = s.ollamaReachable ? 'متصل' : 'غير متصل';
                    oStatus.className = s.ollamaReachable ? 'font-bold text-green-500' : 'font-bold text-red-500';
                }
                if (mStatus) {
                    mStatus.innerText = s.modelAvailable ? 'جاهز' : 'غير متوفر';
                    mStatus.className = s.modelAvailable ? 'font-bold text-green-500' : 'font-bold text-red-500';
                }
                if (cStatus) {
                    cStatus.innerText = s.collectionAvailable ? 'جاهزة' : 'غير موجودة';
                    cStatus.className = s.collectionAvailable ? 'font-bold text-green-500' : 'font-bold text-red-500';
                }
                if (rMode) {
                    if (s.retrievalMode === 'vector-ready') {
                        rMode.innerText = 'البنية المتجهية جاهزة للعمل';
                        rMode.className = 'font-bold text-green-600';
                    } else if (s.retrievalMode === 'legacy-fallback') {
                        rMode.innerText = 'البحث الاحتياطي القديم مفعّل';
                        rMode.className = 'font-bold text-yellow-600';
                    } else {
                        rMode.innerText = 'غير متوفر';
                        rMode.className = 'font-bold text-red-500';
                    }
                }

                // Render statistics
                if (statModel) statModel.innerText = s.embeddingModelName || '-';
                if (statCollection) statCollection.innerText = s.collectionName || '-';
                if (statVectors) statVectors.innerText = s.indexedVectorCount || '0';
                if (statSuccess) statSuccess.innerText = s.lastSuccessfulIndexingTime ? new Date(s.lastSuccessfulIndexingTime).toLocaleString('ar-EG') : 'لم يتم الفهرسة بعد';
                if (statDuration) statDuration.innerText = s.lastIndexingDuration ? `${s.lastIndexingDuration} ملي ثانية` : '0';

                // Update card badges dynamically
                const badgeRAG = document.getElementById('badge-rag-settings');
                if (badgeRAG) {
                    if (s.retrievalMode === 'vector-ready') {
                        badgeRAG.innerText = 'متصل';
                        badgeRAG.className = 'badge-status active';
                    } else if (s.retrievalMode === 'legacy-fallback') {
                        badgeRAG.innerText = 'احتياطي';
                        badgeRAG.className = 'badge-status warning';
                    } else {
                        badgeRAG.innerText = 'غير متصل';
                        badgeRAG.className = 'badge-status danger';
                    }
                }
            }
        } catch (e) {
            console.error('Failed to refresh RAG status:', e);
        }
    },

    // Trigger vector reindexing
    triggerRagReindex: async function() {
        const confirmText = 'سيتم تحديث الفهرس المتجهي لقاعدة المعرفة. قد تستغرق العملية بعض الوقت حسب حجم المحتوى. هل تريد المتابعة؟';
        const proceed = confirm(confirmText);
        if (!proceed) return;

        const btn = document.getElementById('rag-btn-reindex');
        const btnText = document.getElementById('rag-reindex-btn-text');
        if (btn) btn.disabled = true;
        if (btnText) btnText.innerText = 'جاري فهرسة قاعدة المعرفة...';

        try {
            const response = await window.Dashboard.api.request('/api/rag/reindex', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force: true })
            });

            const data = await response.json();

            if (data.success) {
                if (data.status === 'unchanged') {
                    window.Dashboard.settings.showToast('قاعدة المعرفة محدثة بالفعل، ولم يتم إنشاء Embeddings جديدة.');
                } else {
                    window.Dashboard.settings.showToast(`تمت فهرسة قاعدة المعرفة بنجاح. المقاطع المنشأة: ${data.chunksCreated}، المدة: ${data.durationMs}ms`);
                }
                await window.Dashboard.settings.refreshRagStatus();
            } else {
                window.Dashboard.settings.showToast(data.message || data.error || 'فشلت عملية إعادة الفهرسة.', 'error');
            }
        } catch (err) {
            window.Dashboard.settings.showToast('حدث خطأ بالاتصال بالخادم لإعادة الفهرسة.', 'error');
        } finally {
            if (btn) btn.disabled = false;
            if (btnText) btnText.innerText = 'إعادة فهرسة قاعدة المعرفة';
        }
    },

    submitRAGSettings: function() {
        const chunkSize = parseInt(document.getElementById('rag-chunk-size-input').value, 10);
        const chunkOverlap = parseInt(document.getElementById('rag-chunk-overlap-input').value, 10);
        const ragEmbeddingModel = document.getElementById('rag-embedding-model-input').value.trim();
        const qdrantCollection = document.getElementById('qdrant-collection-input').value.trim();
        const qdrantUrl = document.getElementById('qdrant-url-input').value.trim();
        const ollamaBaseUrl = document.getElementById('ollama-url-input').value.trim();
        const ragIndexOnStartup = document.getElementById('rag-index-startup-select').value === 'true';
        const ragLegacyFallback = document.getElementById('rag-legacy-fallback-select').value === 'true';

        const ragNeighborExpansion = document.getElementById('rag-neighbor-expansion-select').value === 'true';
        const ragContextBudget = parseInt(document.getElementById('rag-context-budget-input').value, 10);
        const ragMinTopK = parseInt(document.getElementById('rag-min-top-k-input').value, 10);
        const ragDefaultTopK = parseInt(document.getElementById('rag-default-top-k-input').value, 10);
        const ragMaxTopK = parseInt(document.getElementById('rag-max-top-k-input').value, 10);
        const ragCandidateMultiplier = parseInt(document.getElementById('rag-candidate-multiplier-input').value, 10);
        const ragSemanticWeight = parseFloat(document.getElementById('rag-semantic-weight-input').value);
        const ragKeywordWeight = parseFloat(document.getElementById('rag-keyword-weight-input').value);
        const ragSimilarityThreshold = parseFloat(document.getElementById('rag-similarity-threshold-input').value);

        // Perform front-end validation
        if (isNaN(chunkSize) || chunkSize < 200 || chunkSize > 4000) {
            alert('حجم المقطع يجب أن يكون بين 200 و 4000 حرف.');
            return;
        }
        if (isNaN(chunkOverlap) || chunkOverlap < 0 || chunkOverlap > 1000) {
            alert('التداخل يجب أن يكون بين 0 و 1000 حرف.');
            return;
        }
        if (chunkOverlap >= chunkSize) {
            alert('يجب أن يكون تداخل المقاطع أصغر من حجم المقطع نفسه.');
            return;
        }
        if (isNaN(ragMinTopK) || isNaN(ragDefaultTopK) || isNaN(ragMaxTopK) || ragMinTopK > ragDefaultTopK || ragDefaultTopK > ragMaxTopK) {
            alert('الرجاء التأكد من صحة Top-K (يجب أن يكون الأدنى <= الافتراضي <= الأعلى).');
            return;
        }
        if (isNaN(ragSemanticWeight) || isNaN(ragKeywordWeight) || Math.abs(ragSemanticWeight + ragKeywordWeight - 1.0) > 0.01) {
            alert('مجموع وزن البحث الدلالي والوزن بالكلمات يجب أن يكون مساوياً لـ 1.0 تقريباً.');
            return;
        }

        window.Dashboard.conversationControls.openSettingsConfirmModal(
            'rag-settings',
            {
                ragChunkSize, ragChunkOverlap, ragEmbeddingModel, qdrantCollection,
                ragIndexOnStartup, ragLegacyFallback, qdrantUrl, ollamaBaseUrl,
                ragNeighborExpansion, ragContextBudget, ragMinTopK, ragDefaultTopK,
                ragMaxTopK, ragCandidateMultiplier, ragSemanticWeight, ragKeywordWeight,
                ragSimilarityThreshold
            },
            'تأكيد تعديل إعدادات الـ RAG؟',
            'تم حفظ الإعدادات. تتطلب التغييرات إعادة فهرسة قاعدة المعرفة حتى تصبح فعالة بالكامل.',
            'RAG',
            'bg-slate-900 hover:bg-slate-950'
        );
    },

    handleDrawerSaveBtn: function() {
        const formType = window.Dashboard.state.activeDrawerForm;
        if (!formType) return;

        switch (formType) {
            case 'ai':
                window.Dashboard.settings.submitAISettings();
                break;
            case 'knowledge':
                window.Dashboard.settings.saveKnowledgeBase();
                break;
            case 'telegram':
                window.Dashboard.settings.submitTelegramSettings();
                break;
            case 'whatsapp':
                window.Dashboard.settings.submitWhatsAppSettings();
                break;
            case 'messenger':
                window.Dashboard.settings.submitMessengerSettings();
                break;
            case 'instagram':
                window.Dashboard.settings.submitInstagramSettings();
                break;
            case 'meta':
                window.Dashboard.settings.submitMetaVerifySettings();
                break;
            case 'general':
                window.Dashboard.settings.submitPasswordChange();
                break;
            case 'rag-settings':
                window.Dashboard.settings.submitRAGSettings();
                break;
        }
    },

    // A. Load Documents List
    loadDocumentsList: async function() {
        const listContainer = document.getElementById('uploaded-docs-list');
        if (!listContainer) return;

        try {
            const response = await window.Dashboard.api.request('/api/rag/documents');
            const data = await response.json();

            if (data.success && data.documents) {
                if (data.documents.length === 0) {
                    listContainer.innerHTML = `
                        <div class="text-slate-400 text-center py-6 text-[10px] font-arabic leading-relaxed">
                            لا يوجد مستندات مرفوعة حالياً.
                        </div>
                    `;
                    return;
                }

                let html = '';
                data.documents.forEach(d => {
                    // Status Badge Styling
                    let badgeClass = 'bg-slate-50 text-slate-700 border-slate-200';
                    let statusText = d.status;

                    if (d.status === 'indexed') {
                        badgeClass = 'bg-green-50 text-green-700 border-green-200';
                        statusText = 'مفهرس';
                    } else if (d.status === 'uploaded') {
                        badgeClass = 'bg-blue-50 text-blue-700 border-blue-200';
                        statusText = 'تم الرفع';
                    } else if (d.status === 'parsing') {
                        badgeClass = 'bg-yellow-50 text-yellow-700 border-yellow-200';
                        statusText = 'جاري استخراج النص';
                    } else if (d.status === 'parsed') {
                        badgeClass = 'bg-yellow-50 text-yellow-700 border-yellow-200';
                        statusText = 'جاهز للفهرسة';
                    } else if (d.status === 'indexing') {
                        badgeClass = 'bg-yellow-50 text-yellow-700 border-yellow-200';
                        statusText = 'جاري الفهرسة';
                    } else if (d.status === 'failed') {
                        badgeClass = 'bg-red-50 text-red-700 border-red-200';
                        statusText = 'فشل';
                    } else if (d.status === 'deleting') {
                        badgeClass = 'bg-slate-100 text-slate-500 border-slate-300';
                        statusText = 'جاري الحذف';
                    }

                    // Format File Size
                    const formattedSize = window.Dashboard.utils && window.Dashboard.utils.formatBytes
                        ? window.Dashboard.utils.formatBytes(d.fileSize)
                        : `${(d.fileSize / 1024).toFixed(1)} KB`;

                    // Icon and Color based on extension
                    let iconColor = 'text-blue-500 bg-blue-50';
                    let fileIcon = `
                        <svg class="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                        </svg>
                    `;

                    if (d.fileType === 'PDF') {
                        iconColor = 'text-red-500 bg-red-50';
                        fileIcon = `
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                            </svg>
                        `;
                    } else if (d.fileType === 'DOCX') {
                        iconColor = 'text-sky-500 bg-sky-50';
                    } else if (d.fileType === 'MANUAL') {
                        iconColor = 'text-purple-500 bg-purple-50';
                        fileIcon = `
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                            </svg>
                        `;
                    }

                    // Action buttons
                    let actionButtons = '';
                    if (d.status === 'failed') {
                        actionButtons += `
                            <button type="button" onclick="window.Dashboard.settings.retryFailedDocumentUI('${d.documentId}')" class="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-[10px] font-bold transition font-arabic flex items-center gap-1 shadow-sm">
                                <span>إعادة المحاولة</span>
                            </button>
                        `;
                    } else if (d.status !== 'deleting') {
                        actionButtons += `
                            <button type="button" onclick="window.Dashboard.settings.reindexDocumentUI('${d.documentId}')" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold transition font-arabic flex items-center gap-1 border border-slate-200">
                                <span>إعادة الفهرسة</span>
                            </button>
                        `;
                    }

                    if (d.status !== 'deleting') {
                        actionButtons += `
                            <button type="button" onclick="window.Dashboard.settings.deleteDocumentUI('${d.documentId}', '${d.originalFilename.replace(/'/g, "\\'")}')" class="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded text-[10px] font-bold transition font-arabic flex items-center gap-1 border border-red-200">
                                <span>حذف</span>
                            </button>
                        `;
                    }

                    // Failure message tooltip
                    const failureTooltip = d.indexingError ? `
                        <div class="text-[9px] text-red-500 font-semibold mt-1 font-arabic border-t border-red-100 pt-1">
                            الخطأ: ${window.Dashboard.utils.escapeHTML(d.indexingError)}
                        </div>
                    ` : '';

                    html += `
                        <div class="p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col space-y-3 select-text">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-lg flex items-center justify-center ${iconColor} shrink-0">
                                    ${fileIcon}
                                </div>
                                <div class="flex-1 min-w-0">
                                    <div class="text-xs font-bold text-slate-800 truncate font-arabic" title="${window.Dashboard.utils.escapeHTML(d.originalFilename)}">
                                        ${window.Dashboard.utils.escapeHTML(d.originalFilename)}
                                    </div>
                                    <div class="flex items-center gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
                                        <span>${d.fileType}</span>
                                        <span>•</span>
                                        <span>${formattedSize}</span>
                                        <span>•</span>
                                        <span>${d.chunkCount} مقطع</span>
                                    </div>
                                </div>
                                <div class="shrink-0 flex flex-col items-end gap-1">
                                    <span class="text-[9px] font-bold px-2 py-0.5 rounded-full border ${badgeClass}">
                                        ${statusText}
                                    </span>
                                </div>
                            </div>
                            ${failureTooltip}
                            <div class="flex justify-end gap-2 border-t border-slate-100 pt-3">
                                ${actionButtons}
                            </div>
                        </div>
                    `;
                });

                listContainer.innerHTML = html;
            }
        } catch (err) {
            console.error('Failed to load documents list:', err);
            listContainer.innerHTML = `
                <div class="text-red-500 text-center py-6 text-[10px] font-arabic">
                    تعذر تحميل قائمة المستندات حالياً.
                </div>
            `;
        }
    },

    // B. Setup Drag and Drop
    setupDragAndDrop: function() {
        const zone = document.getElementById('drag-drop-zone');
        if (!zone) return;

        // Prevent default drag behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            zone.addEventListener(eventName, e => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        // Highlight zone on drag over
        ['dragenter', 'dragover'].forEach(eventName => {
            zone.addEventListener(eventName, () => {
                zone.classList.add('bg-blue-50/50', 'border-blue-500');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            zone.addEventListener(eventName, () => {
                zone.classList.remove('bg-blue-50/50', 'border-blue-500');
            }, false);
        });

        // Handle dropped files
        zone.addEventListener('drop', e => {
            const dt = e.dataTransfer;
            const files = dt.files;
            window.Dashboard.settings.handleDocumentUpload(files);
        }, false);
    },

    // C. Handle Document Upload
    handleDocumentUpload: async function(files) {
        if (!files || files.length === 0) return;

        const file = files[0]; // Process one file at a time as robust default

        // 1. Basic frontend size check (10MB limit)
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            alert('حجم الملف كبير جداً. الحد الأقصى المسموح به هو 10 ميجابايت.');
            return;
        }

        // 2. Extension validation
        const ext = file.name.split('.').pop().toLowerCase();
        const allowed = ['pdf', 'txt', 'docx', 'md'];
        if (!allowed.includes(ext)) {
            alert('نوع الملف غير مدعوم. الصيغ المدعومة: PDF, TXT, DOCX, MD.');
            return;
        }

        // Disable other interactions and show progress container
        const progressContainer = document.getElementById('upload-progress-container');
        const progressStatus = document.getElementById('upload-progress-status');
        const progressPercentage = document.getElementById('upload-progress-percentage');
        const progressBar = document.getElementById('upload-progress-bar');
        const uploadInput = document.getElementById('doc-file-input');

        if (progressContainer) progressContainer.classList.remove('hidden');
        if (progressBar) progressBar.style.width = '0%';
        if (progressPercentage) progressPercentage.innerText = '0%';
        if (progressStatus) progressStatus.innerText = 'جاري رفع الملف...';
        if (uploadInput) uploadInput.disabled = true;

        try {
            // Get CSRF token
            let csrfToken = window.Dashboard.api.csrfToken;
            if (!csrfToken) {
                csrfToken = await window.Dashboard.api.fetchCsrfToken();
            }

            const formData = new FormData();
            formData.append('file', file);

            const xhr = new XMLHttpRequest();
            const baseUrl = window.ENV ? window.ENV.API_BASE_URL : '/api/v1';
            xhr.open('POST', `${baseUrl}/rag/documents/upload`, true);
            xhr.withCredentials = true;

            if (csrfToken) {
                xhr.setRequestHeader('X-CSRF-Token', csrfToken);
            }

            xhr.upload.onprogress = function(e) {
                if (e.lengthComputable) {
                    const percentage = Math.round((e.loaded / e.total) * 100);
                    if (progressBar) progressBar.style.width = `${percentage}%`;
                    if (progressPercentage) progressPercentage.innerText = `${percentage}%`;

                    if (percentage === 100) {
                        if (progressStatus) progressStatus.innerText = 'جاري استخراج وتحليل نصوص المستند...';
                    }
                }
            };

            xhr.onload = function() {
                if (uploadInput) uploadInput.disabled = false;
                if (progressContainer) progressContainer.classList.add('hidden');

                if (xhr.status === 401) {
                    window.location.href = '/login';
                    return;
                }

                let result;
                try {
                    result = JSON.parse(xhr.responseText);
                } catch (e) {
                    result = { success: false, error: 'تعذر تحليل رد السيرفر' };
                }

                if (xhr.status >= 200 && xhr.status < 300 && result.success) {
                    window.Dashboard.settings.showToast('تم رفع وتضمين المستند في الـ RAG بنجاح.');
                    window.Dashboard.settings.loadDocumentsList();
                    window.Dashboard.settings.refreshRagStatus();
                } else {
                    alert('فشل الرفع: ' + (result.error || 'خطأ غير معروف'));
                }
            };

            xhr.onerror = function() {
                if (uploadInput) uploadInput.disabled = false;
                if (progressContainer) progressContainer.classList.add('hidden');
                alert('حدث خطأ في الاتصال بالخادم أثناء رفع الملف.');
            };

            xhr.send(formData);

        } catch (err) {
            if (uploadInput) uploadInput.disabled = false;
            if (progressContainer) progressContainer.classList.add('hidden');
            console.error('Upload failed:', err);
            alert('فشل الرفع: ' + err.message);
        }
    },

    // D. Reindex Document
    reindexDocumentUI: async function(docId) {
        const confirmText = 'سيتم إعادة بناء المتجهات والمقاطع لهذا المستند بالاعتماد على إعدادات الـ RAG الحالية. هل تريد المتابعة؟';
        const proceed = confirm(confirmText);
        if (!proceed) return;

        try {
            const response = await window.Dashboard.api.request(`/api/rag/documents/${docId}/reindex`, {
                method: 'POST'
            });
            const result = await response.json();

            if (result.success) {
                window.Dashboard.settings.showToast('تمت إعادة فهرسة المستند بنجاح.');
                window.Dashboard.settings.loadDocumentsList();
                window.Dashboard.settings.refreshRagStatus();
            } else {
                window.Dashboard.settings.showToast('فشلت إعادة الفهرسة: ' + result.error, 'error');
            }
        } catch (err) {
            console.error(err);
            window.Dashboard.settings.showToast('حدث خطأ بالاتصال بالخادم لإعادة الفهرسة.', 'error');
        }
    },

    // E. Retry Failed Document Indexing
    retryFailedDocumentUI: async function(docId) {
        try {
            const response = await window.Dashboard.api.request(`/api/rag/documents/${docId}/retry`, {
                method: 'POST'
            });
            const result = await response.json();

            if (result.success) {
                window.Dashboard.settings.showToast('جاري إعادة معالجة المستند...');
                window.Dashboard.settings.loadDocumentsList();
                window.Dashboard.settings.refreshRagStatus();
            } else {
                window.Dashboard.settings.showToast('تعذرت المحاولة: ' + result.error, 'error');
            }
        } catch (err) {
            console.error(err);
            window.Dashboard.settings.showToast('حدث خطأ بالاتصال بالخادم لإعادة المحاولة.', 'error');
        }
    },

    // F. Delete Document
    deleteDocumentUI: async function(docId, docName) {
        const confirmText = `سيتم حذف مستند "${docName}" وجميع مقاطعه ومتجهاته من قاعدة المعرفة بشكل نهائي. لا يمكن التراجع عن هذا الإجراء. هل تريد المتابعة؟`;
        const proceed = confirm(confirmText);
        if (!proceed) return;

        try {
            const response = await window.Dashboard.api.request(`/api/rag/documents/${docId}`, {
                method: 'DELETE'
            });
            const result = await response.json();

            if (result.success) {
                window.Dashboard.settings.showToast('تم حذف المستند بنجاح.');
                window.Dashboard.settings.loadDocumentsList();
                window.Dashboard.settings.refreshRagStatus();
            } else {
                window.Dashboard.settings.showToast('فشل حذف المستند: ' + result.error, 'error');
            }
        } catch (err) {
            console.error(err);
            window.Dashboard.settings.showToast('حدث خطأ بالاتصال بالخادم لحذف المستند.', 'error');
        }
    },

    handleDrawerCancelBtn: function() {
        window.Dashboard.settings.closeSettingsDrawer();
    }
};

// Bind keyboard escape listener
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const unsavedModal = document.getElementById('unsaved-modal');
        if (unsavedModal && unsavedModal.classList.contains('active')) {
            window.Dashboard.settings.dismissUnsavedConfirmation();
            return;
        }

        const confirmModal = document.getElementById('confirm-modal');
        if (confirmModal && !confirmModal.classList.contains('hidden')) {
            window.Dashboard.conversationControls.closeConfirmModal();
            return;
        }

        if (window.Dashboard.state.drawerOpen) {
            window.Dashboard.settings.closeSettingsDrawer();
        }
    }
});

// Hijack fetchStatsAndUsers to update cards status on every poll / socket emission
const originalFetchStatsAndUsers = window.Dashboard.analytics.fetchStatsAndUsers;
window.Dashboard.analytics.fetchStatsAndUsers = async function() {
    await originalFetchStatsAndUsers();
    await window.Dashboard.settings.recordInitialFormValues('general'); // Keep general initial settings synced
    await window.Dashboard.settings.updateCardBadges();
};

// Bind to global namespace for inline and backward compatibility
window.saveKnowledgeBase = window.Dashboard.settings.saveKnowledgeBase;
window.submitAISettings = window.Dashboard.settings.submitAISettings;
window.submitTelegramSettings = window.Dashboard.settings.submitTelegramSettings;
window.submitWhatsAppSettings = window.Dashboard.settings.submitWhatsAppSettings;
window.submitMessengerSettings = window.Dashboard.settings.submitMessengerSettings;
window.submitInstagramSettings = window.Dashboard.settings.submitInstagramSettings;
window.submitMetaVerifySettings = window.Dashboard.settings.submitMetaVerifySettings;
window.submitPasswordChange = window.Dashboard.settings.submitPasswordChange;

window.openSettingsDrawer = window.Dashboard.settings.openSettingsDrawer;
window.closeSettingsDrawer = window.Dashboard.settings.closeSettingsDrawer;
window.handleDrawerCloseBtn = window.Dashboard.settings.handleDrawerCloseBtn;
window.handleDrawerSaveBtn = window.Dashboard.settings.handleDrawerSaveBtn;
window.handleDrawerCancelBtn = window.Dashboard.settings.handleDrawerCancelBtn;
window.handleBackdropClick = window.Dashboard.settings.handleBackdropClick;
window.togglePasswordVisibility = window.Dashboard.settings.togglePasswordVisibility;
window.copyCallbackUrl = window.Dashboard.settings.copyCallbackUrl;
window.updateCharCounter = window.Dashboard.settings.updateCharCounter;
window.dismissUnsavedConfirmation = window.Dashboard.settings.dismissUnsavedConfirmation;
window.confirmDiscardChanges = window.Dashboard.settings.confirmDiscardChanges;

window.triggerRagReindex = window.Dashboard.settings.triggerRagReindex;
window.refreshRagStatus = window.Dashboard.settings.refreshRagStatus;

window.loadDocumentsList = window.Dashboard.settings.loadDocumentsList;
window.setupDragAndDrop = window.Dashboard.settings.setupDragAndDrop;
window.handleDocumentUpload = window.Dashboard.settings.handleDocumentUpload;
window.reindexDocumentUI = window.Dashboard.settings.reindexDocumentUI;
window.deleteDocumentUI = window.Dashboard.settings.deleteDocumentUI;
window.retryFailedDocumentUI = window.Dashboard.settings.retryFailedDocumentUI;

// Dynamic AI Provider and custom models support
window.Dashboard.state.customModels = [];

window.Dashboard.settings.populateModelsDropdown = async function(provider) {
    const select = document.getElementById('model-select');
    if (!select) return;

    select.innerHTML = '';

    const standardModels = {
        'openrouter': [
            { id: 'openrouter/free', name: 'Auto Router (Standard)' },
            { id: 'openai/gpt-5', name: 'GPT-5' },
            { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
            { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (Professional)' }
        ],
        'openai': [
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Default)' },
            { id: 'gpt-5', name: 'GPT-5' },
            { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
            { id: 'gpt-4.1', name: 'GPT-4.1' }
        ],
        'gemini': [
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Default)' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' }
        ],
        'ollama': [
            { id: 'llama3', name: 'Llama 3 (Default)' }
        ]
    };

    // Load standard models
    const models = [...(standardModels[provider] || [])];

    // Load custom models matching this provider
    const customList = window.Dashboard.state.customModels || [];
    customList.forEach(m => {
        if (m.provider === provider) {
            models.push({ id: m.id, name: m.name });
        }
    });

    // For Ollama, dynamically query available local models from backend endpoint
    if (provider === 'ollama') {
        try {
            const response = await window.Dashboard.api.request('/api/ai/ollama-models');
            const data = await response.json();
            if (data.success && Array.isArray(data.models) && data.models.length > 0) {
                // Clear standard model options to prefer Ollama local tags
                models.length = 0;
                data.models.forEach(modelName => {
                    models.push({ id: modelName, name: `${modelName} (Local)` });
                });
            }
        } catch (e) {
            console.warn('Ollama dynamic model listing failed:', e);
        }
    }

    // Populate select element with resolved models list
    models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.innerText = m.name;
        select.appendChild(opt);
    });

    // Reselect pending loaded model if matches
    if (window.Dashboard.state.pendingLoadedModel) {
        const valueToSelect = window.Dashboard.state.pendingLoadedModel;

        // Check if the loaded model option already exists
        let exists = false;
        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === valueToSelect) {
                exists = true;
                break;
            }
        }

        // If it doesn't exist, create it dynamically as option so we don't lose selection
        if (!exists) {
            const opt = document.createElement('option');
            opt.value = valueToSelect;
            opt.innerText = `${valueToSelect} (مخصص)`;
            select.appendChild(opt);
        }

        select.value = valueToSelect;
        window.Dashboard.state.pendingLoadedModel = null;
    }

    // Setup Delete Custom Model button check
    const deleteContainer = document.getElementById('settings-delete-model-container');
    if (deleteContainer) {
        const updateDeleteBtnVisibility = () => {
            const val = select.value;
            const isCustom = (window.Dashboard.state.customModels || []).some(m => m.id === val);
            if (isCustom) {
                deleteContainer.classList.remove('hidden');
            } else {
                deleteContainer.classList.add('hidden');
            }
        };
        select.onchange = updateDeleteBtnVisibility;
        updateDeleteBtnVisibility();
    }
};

window.showAddCustomModelDialog = function() {
    const modal = document.getElementById('custom-model-modal');
    if (modal) {
        modal.classList.remove('hidden');
        document.getElementById('custom-model-name').value = '';
        document.getElementById('custom-model-id').value = '';
    }
};

window.hideCustomModelModal = function() {
    const modal = document.getElementById('custom-model-modal');
    if (modal) modal.classList.add('hidden');
};

window.saveCustomModelUI = async function() {
    const name = document.getElementById('custom-model-name').value.trim();
    const id = document.getElementById('custom-model-id').value.trim();
    const provider = document.getElementById('ai-provider-select').value;

    if (!name || !id) {
        alert('يرجى إدخال اسم العرض ومعرّف النموذج.');
        return;
    }

    // Create new timestamp
    const now = Date.now();
    window.Dashboard.state.customModelsTimestamp = now;

    // Add to state list
    window.Dashboard.state.customModels = window.Dashboard.state.customModels || [];
    window.Dashboard.state.customModels.push({ provider, name, id });

    // Persist immediately in settings database
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
            // Hide modal
            window.hideCustomModelModal();

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
            window.Dashboard.state.pendingLoadedModel = id;
            await window.Dashboard.settings.populateModelsDropdown(provider);

            if (window.Dashboard.aimodels && window.Dashboard.aimodels.populateModelsDropdown) {
                await window.Dashboard.aimodels.populateModelsDropdown(provider, id);
            }

            window.Dashboard.settings.showToast('تمت إضافة النموذج المخصص بنجاح وجعله متاحاً فوراً.');
        } else {
            alert(`فشل حفظ النموذج المخصص بالسيرفر: ${data.error}`);
        }
    } catch (err) {
        console.error("Failed to persist custom model:", err);
        alert(`خطأ في الاتصال بحفظ النموذج المخصص: ${err.message}`);
    }
};

// Bind provider change listener on startup or when settings open
document.addEventListener('DOMContentLoaded', () => {
    const provSelect = document.getElementById('ai-provider-select');
    if (provSelect) {
        provSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            const keyContainer = document.getElementById('ai-api-key-container');
            const urlContainer = document.getElementById('ai-base-url-container');

            if (val === 'ollama') {
                if (keyContainer) keyContainer.classList.add('hidden');
                if (urlContainer) urlContainer.classList.remove('hidden');
            } else {
                if (keyContainer) keyContainer.classList.remove('hidden');
                if (urlContainer) urlContainer.classList.add('hidden');
            }

            window.Dashboard.settings.populateModelsDropdown(val);
        });
    }
});
