// Minimal & Premium Redesigned AI Provider API Key Management Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.apiKeys = {
    init: function() {
        console.log('🔑 Initializing Premium API Keys Management Module...');
        this.loadApiKeys();
    },

    loadApiKeys: async function() {
        const container = document.getElementById('api-keys-container');
        if (!container) return;

        try {
            const response = await window.Dashboard.api.request('/api/providers/api-keys');
            const data = await response.json();

            if (data.success && data.apiKeys) {
                this.renderCards(data.apiKeys, container);
            }
        } catch (err) {
            console.error('Failed to load API keys:', err);
        }
    },

    renderCards: function(groupedKeys, container) {
        let html = '';
        const providers = ['openrouter', 'openai', 'gemini', 'anthropic'];

        providers.forEach(prov => {
            const keys = groupedKeys[prov] || [];
            const key = keys[0] || null; // Exactly ONE API Key per provider

            let displayProvName = '';
            let logo = '';
            if (prov === 'openrouter') { displayProvName = 'OpenRouter'; logo = '🚀'; }
            else if (prov === 'openai') { displayProvName = 'OpenAI'; logo = '🧠'; }
            else if (prov === 'gemini') { displayProvName = 'Google Gemini'; logo = '✨'; }
            else if (prov === 'anthropic') { displayProvName = 'Anthropic'; logo = '👤'; }

            const isConfigured = !!key;
            const hasError = key ? !!key.errorMessage : false;

            // Connected / Invalid / Missing status
            let statusBadge = '';
            if (!isConfigured) {
                statusBadge = `<span class="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 font-arabic">غير مضاف</span>`;
            } else if (hasError) {
                statusBadge = `<span class="text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-50 text-red-650 border border-red-200 font-arabic">غير صالح</span>`;
            } else {
                statusBadge = `<span class="text-[10px] font-bold px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 font-arabic">متصل</span>`;
            }

            // Masked key value for input field
            const maskedDisplay = key ? key.maskedKey : '';

            // Metric section based on provider capabilities
            let metricsHtml = '';
            if (isConfigured) {
                if (key.limitsAvailable) {
                    const limitVal = key.limitVal || 0;
                    const usageVal = key.usageVal || 0;
                    const remainingVal = key.remainingBalance || 0;
                    const percentage = limitVal > 0 ? parseFloat(((usageVal / limitVal) * 100).toFixed(1)) : 0;

                    metricsHtml = `
                        <div class="space-y-4 pt-2 border-t border-slate-100">
                            <!-- Large Readable Numbers -->
                            <div class="grid grid-cols-2 gap-4">
                                <div class="bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                                    <span class="text-[10px] text-slate-400 font-arabic block mb-1">الرصيد المتبقي (Remaining)</span>
                                    <span class="text-xl font-bold text-blue-650 font-mono">$${remainingVal.toFixed(4)}</span>
                                </div>
                                <div class="bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                                    <span class="text-[10px] text-slate-400 font-arabic block mb-1">الاستخدام (Usage)</span>
                                    <span class="text-xl font-bold text-slate-800 font-mono">$${usageVal.toFixed(4)}</span>
                                </div>
                            </div>

                            <!-- Progress Bar (Only if limit is returned and > 0) -->
                            ${limitVal > 0 ? `
                                <div class="space-y-1">
                                    <div class="flex justify-between items-center text-[10px] text-slate-400 font-mono">
                                        <span>حد المفتاح (Key Quota Limit): $${limitVal.toFixed(2)}</span>
                                        <span>نسبة الاستهلاك: ${percentage}%</span>
                                    </div>
                                    <div class="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                                        <div class="bg-blue-600 h-2 transition-all duration-500" style="width: ${percentage}%"></div>
                                    </div>
                                </div>
                            ` : ''}

                            <!-- Reset Date & Last Sync -->
                            <div class="flex justify-between text-[10px] text-slate-400 bg-slate-50/50 p-2 rounded-lg border border-slate-100 font-mono">
                                <span>إعادة التعيين: ${key.resetDate || 'N/A'}</span>
                                <span>آخر مزامنة: ${key.lastSyncSuccess ? new Date(key.lastSyncSuccess).toLocaleTimeString('ar-EG') : 'N/A'}</span>
                            </div>
                        </div>
                    `;
                } else {
                    // Fallback area when limits are unavailable
                    metricsHtml = `
                        <div class="bg-amber-50/40 p-4 rounded-xl border border-amber-100/60 text-center text-xs font-arabic text-amber-700 leading-relaxed pt-2 border-t border-slate-100 mt-2">
                            API Key usage information is not available from this provider.
                            <div class="text-[10px] text-slate-400 mt-1 font-mono">
                                آخر مزامنة: ${key.lastSyncSuccess ? new Date(key.lastSyncSuccess).toLocaleTimeString('ar-EG') : 'N/A'}
                            </div>
                        </div>
                    `;
                }

                if (hasError) {
                    metricsHtml += `
                        <div class="text-[10px] text-red-500 leading-relaxed font-arabic mt-2 bg-red-50/50 p-2.5 rounded-lg border border-red-100">
                            خطأ المزامنة: ${window.Dashboard.utils.escapeHTML(String(key.errorMessage || ''))}
                        </div>
                    `;
                }
            } else {
                metricsHtml = `
                    <div class="text-center py-6 text-slate-400 text-xs font-arabic pt-2 border-t border-slate-100">
                        يرجى إدخال مفتاح الـ API لتنشيط المزود ومزامنة حدوده تلقائياً.
                    </div>
                `;
            }

            html += `
                <div class="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-4 flex flex-col justify-between">
                    <div class="space-y-4">
                        <!-- Card Header -->
                        <div class="flex justify-between items-center pb-1">
                            <div class="flex items-center gap-2.5">
                                <span class="text-xl">${logo}</span>
                                <span class="font-bold text-sm text-slate-800">${displayProvName}</span>
                            </div>
                            ${statusBadge}
                        </div>

                        <!-- One API Key Input -->
                        <div class="space-y-2">
                            <label class="block text-[10px] font-bold text-slate-500 font-arabic">مفتاح الـ API (API Key)</label>
                            <div class="flex gap-2">
                                <input type="password" id="key-input-${prov}" class="futh-input bg-slate-50/40 text-xs flex-1"
                                    placeholder="${isConfigured ? '••••••••••••••••' : 'أدخل المفتاح هنا...'}"
                                    value="">
                                <button type="button" data-api-key-save="${window.Dashboard.utils.escapeHTML(prov)}" class="px-4 py-2 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-xl transition shadow-sm font-arabic">
                                    حفظ
                                </button>
                            </div>
                        </div>

                        <!-- Metrics & Usage / Fallback area -->
                        ${metricsHtml}
                    </div>

                    <!-- Refresh Button -->
                    ${isConfigured ? `
                        <div class="flex gap-1.5 pt-3 border-t border-slate-100 justify-end">
                            <button type="button" data-api-key-refresh="${Number(key.id)}" class="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 rounded-lg text-xs font-bold transition font-arabic flex items-center gap-1">
                                <span>🔄 تحديث البيانات</span>
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
        });

        window.Dashboard.utils.setSanitizedHTML(container, html);
        container.querySelectorAll('[data-api-key-save]').forEach(button => {
            button.addEventListener('click', () => {
                window.Dashboard.apiKeys.saveInlineKey(button.dataset.apiKeySave);
            });
        });
        container.querySelectorAll('[data-api-key-refresh]').forEach(button => {
            button.addEventListener('click', () => {
                window.Dashboard.apiKeys.triggerRefresh(Number(button.dataset.apiKeyRefresh), button);
            });
        });
    },

    saveInlineKey: async function(provider) {
        const input = document.getElementById(`key-input-${provider}`);
        if (!input) return;

        const apiKey = input.value.trim();
        if (!apiKey) {
            alert('يرجى كتابة مفتاح الـ API أولاً قبل الحفظ.');
            return;
        }

        try {
            const response = await window.Dashboard.api.request('/api/providers/api-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    friendlyName: `مفتاح ${provider.toUpperCase()}`,
                    provider,
                    apiKey
                })
            });
            const result = await response.json();

            if (result.success) {
                input.value = '';
                if (window.Dashboard.settings && window.Dashboard.settings.showToast) {
                    window.Dashboard.settings.showToast(
                        result.syncSuccess
                            ? 'تم حفظ مفتاح الـ API ومزامنة إمكانات المزود.'
                            : `تم حفظ المفتاح، لكن المزامنة فشلت: ${result.syncError || 'سبب غير معروف'}`,
                        result.syncSuccess ? 'success' : 'error'
                    );
                }
                this.loadApiKeys();
            } else {
                alert('فشل حفظ المفتاح: ' + result.error);
            }
        } catch (err) {
            console.error('Failed to save inline key:', err);
            alert('حدث خطأ أثناء حفظ المفتاح البرمجي.');
        }
    },

    triggerRefresh: async function(id, btn) {
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'جاري التحديث...';
        }

        try {
            const response = await window.Dashboard.api.request(`/api/providers/api-keys/${id}/refresh`, {
                method: 'POST'
            });
            const result = await response.json();
            if (result.success) {
                if (window.Dashboard.settings && window.Dashboard.settings.showToast) {
                    window.Dashboard.settings.showToast('اكتملت مزامنة البيانات من المزود بنجاح!');
                }
                this.loadApiKeys();
            } else {
                alert('فشلت المزامنة: ' + result.error);
            }
        } catch (err) {
            console.error(err);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔄 تحديث البيانات';
            }
        }
    }
};
