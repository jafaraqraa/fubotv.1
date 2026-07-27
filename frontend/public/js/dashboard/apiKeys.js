// Redesigned AI Provider API Key Management Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.apiKeys = {
    init: function() {
        console.log('🔑 Initializing Redesigned API Keys Management Module...');
        this.loadApiKeys();
    },

    loadApiKeys: async function() {
        const container = document.getElementById('api-keys-container');
        const listContainer = document.getElementById('api-keys-management-list');
        if (!container) return;

        try {
            const response = await window.Dashboard.api.request('/api/providers/api-keys');
            const data = await response.json();

            if (data.success && data.apiKeys) {
                this.renderUsageDashboard(data.apiKeys, container);
                if (listContainer) {
                    this.renderManagementList(data.apiKeys, listContainer);
                }
            }
        } catch (err) {
            console.error('Failed to load API keys:', err);
        }
    },

    renderUsageDashboard: function(groupedKeys, container) {
        let html = '';
        const providers = ['openrouter', 'openai', 'gemini', 'anthropic'];

        providers.forEach(prov => {
            const keys = groupedKeys[prov] || [];
            const displayProvName = prov === 'openai' ? 'OpenAI' : (prov === 'openrouter' ? 'OpenRouter' : (prov === 'gemini' ? 'Google Gemini' : 'Anthropic'));

            html += `
                <div class="col-span-1 md:col-span-2 lg:col-span-3 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
                    <div class="flex justify-between items-center border-b border-slate-100 pb-3">
                        <div class="flex items-center gap-2">
                            <span class="text-lg">${prov === 'openrouter' ? '🚀' : (prov === 'openai' ? '🧠' : (prov === 'gemini' ? '✨' : '👤'))}</span>
                            <span class="font-bold text-sm text-slate-800">${displayProvName}</span>
                        </div>
                        <span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${keys.length > 0 ? 'bg-indigo-50 text-indigo-650' : 'bg-slate-100 text-slate-500'}">
                            ${keys.length} مفاتيح نشطة
                        </span>
                    </div>

                    ${keys.length === 0 ? `
                        <div class="text-center py-8 text-slate-400 text-xs font-arabic">
                            لا توجد مفاتيح API مضافة لهذا المزود حالياً.
                        </div>
                    ` : `
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-2">
                            ${keys.map(k => {
                                const percentage = k.limitsAvailable && k.limitVal > 0 ? parseFloat(((k.usageVal / k.limitVal) * 100).toFixed(1)) : 0;
                                const hasError = !!k.errorMessage;
                                const isEstimated = k.source && (k.source.usage === 'estimated' || k.source.remaining === 'estimated');

                                // Render limits / metrics based on adapter capabilities
                                let limitDisplay = 'N/A';
                                let remainingDisplay = 'N/A';
                                let usageDisplay = `$${Number(k.usageVal || 0).toFixed(4)}`;
                                let resetDateDisplay = 'N/A';
                                let billingPeriodDisplay = 'N/A';

                                if (k.limitsAvailable) {
                                    if (k.capabilities.supportsBalance || k.capabilities.supportsUsage) {
                                        limitDisplay = `$${Number(k.limitVal || 0).toFixed(2)}`;
                                        remainingDisplay = `$${Number(k.remainingBalance || 0).toFixed(4)}`;
                                        usageDisplay = `$${Number(k.usageVal || 0).toFixed(4)}`;
                                    }
                                    billingPeriodDisplay = k.billingPeriod || 'Pay-as-you-go';
                                    resetDateDisplay = k.resetDate || 'N/A';
                                } else {
                                    // Use local estimates
                                    usageDisplay = `$${Number(k.used || 0).toFixed(4)}`;
                                }

                                return `
                                    <div class="p-4 rounded-xl border ${k.enabled ? 'border-slate-150 bg-slate-50/40' : 'border-slate-200 bg-slate-100/50 opacity-60'} flex flex-col justify-between space-y-3 select-text relative">
                                        <div class="flex justify-between items-start">
                                            <div>
                                                <div class="text-xs font-bold text-slate-800 font-arabic truncate max-w-[150px]" title="${k.friendlyName}">
                                                    ${k.friendlyName}
                                                </div>
                                                <div class="text-[10px] text-slate-400 font-mono mt-0.5">
                                                    ${k.maskedKey}
                                                </div>
                                            </div>
                                            <span class="text-[9px] font-bold px-2 py-0.5 rounded-full ${k.enabled ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-slate-200 text-slate-500'}">
                                                ${k.enabled ? 'نشط' : 'موقف'}
                                            </span>
                                        </div>

                                        <div class="space-y-2 text-xs pt-1 border-t border-slate-100/60">
                                            <!-- Usage Row -->
                                            <div class="flex justify-between items-center">
                                                <span class="text-slate-500 font-arabic">الاستخدام الحالي:</span>
                                                <div class="flex items-center gap-1">
                                                    <span class="font-bold text-slate-900 font-mono">${usageDisplay}</span>
                                                    ${k.limitsAvailable ? `
                                                        <span class="text-[8px] px-1 rounded bg-indigo-50 text-indigo-600 font-bold font-arabic">مزود</span>
                                                    ` : `
                                                        <span class="text-[8px] px-1 rounded bg-amber-50 text-amber-600 font-bold font-arabic">تقديري محلي</span>
                                                    `}
                                                </div>
                                            </div>

                                            <!-- Limit Row -->
                                            <div class="flex justify-between items-center">
                                                <span class="text-slate-500 font-arabic">الحد الأقصى (Limit):</span>
                                                <div class="flex items-center gap-1">
                                                    <span class="font-semibold text-slate-700 font-mono">
                                                        ${k.limitsAvailable && k.limitVal ? limitDisplay : 'غير متوفر عبر API'}
                                                    </span>
                                                </div>
                                            </div>

                                            <!-- Remaining Row -->
                                            <div class="flex justify-between items-center">
                                                <span class="text-slate-500 font-arabic">المتبقي:</span>
                                                <div class="flex items-center gap-1">
                                                    <span class="font-bold font-mono ${k.limitsAvailable && k.remainingBalance < 2.0 ? 'text-red-500' : 'text-blue-600'}">
                                                        ${k.limitsAvailable && k.limitVal ? remainingDisplay : 'غير متوفر'}
                                                    </span>
                                                    ${isEstimated ? `
                                                        <span class="text-[8px] px-1 rounded bg-amber-50 text-amber-600 font-bold font-arabic">تقدير محلي</span>
                                                    ` : (k.limitsAvailable ? `
                                                        <span class="text-[8px] px-1 rounded bg-indigo-50 text-indigo-600 font-bold font-arabic">مزود</span>
                                                    ` : '')}
                                                </div>
                                            </div>

                                            <!-- Usage Pct Row -->
                                            ${k.limitsAvailable && k.limitVal ? `
                                                <div class="space-y-1">
                                                    <div class="flex justify-between items-center text-[10px] text-slate-400 font-mono">
                                                        <span>نسبة الاستهلاك:</span>
                                                        <span>${percentage}%</span>
                                                    </div>
                                                    <div class="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                                        <div class="bg-blue-600 h-1.5 transition-all duration-500" style="width: ${percentage}%"></div>
                                                    </div>
                                                </div>
                                            ` : ''}

                                            <!-- Billing Period & Reset Date -->
                                            <div class="flex justify-between text-[10px] text-slate-400 border-t border-slate-100 pt-1.5">
                                                <span>الفترة: <strong class="text-slate-600">${billingPeriodDisplay}</strong></span>
                                                <span>إعادة التعيين: <strong class="text-slate-600 font-mono">${resetDateDisplay}</strong></span>
                                            </div>

                                            <!-- Sync Status -->
                                            <div class="flex justify-between items-center text-[9px] text-slate-400 mt-1 bg-slate-50/50 p-1.5 rounded border border-slate-100">
                                                <span class="font-mono">مزامنة: ${k.lastSyncSuccess ? new Date(k.lastSyncSuccess).toLocaleTimeString('ar-EG') : 'لم تتم بعد'}</span>
                                                <div class="flex items-center gap-1">
                                                    <span class="w-1.5 h-1.5 rounded-full ${hasError ? 'bg-red-500 animate-pulse' : 'bg-green-500'}"></span>
                                                    <span class="${hasError ? 'text-red-500 font-bold' : 'text-green-600'}">
                                                        ${hasError ? 'خطأ اتصال' : 'ناجحة'}
                                                    </span>
                                                </div>
                                            </div>

                                            ${hasError ? `
                                                <div class="text-[8px] text-red-500 leading-relaxed font-arabic mt-1 border-t border-red-100 pt-1">
                                                    العطل: ${k.errorMessage}
                                                </div>
                                            ` : ''}
                                        </div>

                                        <div class="flex gap-1.5 pt-2 border-t border-slate-100/60 justify-end">
                                            <button onclick="window.Dashboard.apiKeys.triggerRefresh(${k.id}, this)" class="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 rounded text-[9px] font-bold transition font-arabic flex items-center gap-1">
                                                <span>تحديث يدوي</span>
                                            </button>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    `}
                </div>
            `;
        });

        container.innerHTML = html;
    },

    renderManagementList: function(groupedKeys, container) {
        let html = '';
        const providers = ['openrouter', 'openai', 'gemini', 'anthropic'];

        let allKeys = [];
        providers.forEach(prov => {
            allKeys.push(...(groupedKeys[prov] || []));
        });

        if (allKeys.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8 text-slate-400 text-xs font-arabic">
                    لم يتم إضافة مفاتيح API للذكاء الاصطناعي بعد.
                </div>
            `;
            return;
        }

        allKeys.forEach(k => {
            html += `
                <div class="flex items-center justify-between p-3.5 bg-slate-50/60 border border-slate-150 rounded-xl">
                    <div class="min-w-0">
                        <div class="text-xs font-bold text-slate-800 font-arabic truncate max-w-[200px]">
                            ${k.friendlyName}
                        </div>
                        <div class="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 uppercase font-mono">
                            <span class="font-bold text-indigo-650">${k.provider}</span>
                            <span>•</span>
                            <span>${k.maskedKey}</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <!-- Toggle Button -->
                        <button onclick="window.Dashboard.apiKeys.toggleKey(${k.id}, ${!k.enabled})" class="px-2 py-1 ${k.enabled ? 'bg-red-50 hover:bg-red-100 text-red-650' : 'bg-green-50 hover:bg-green-100 text-green-700'} rounded text-[10px] font-bold transition font-arabic">
                            ${k.enabled ? 'إيقاف' : 'تشغيل'}
                        </button>
                        <!-- Delete Button -->
                        <button onclick="window.Dashboard.apiKeys.deleteKey(${k.id})" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-[10px] font-bold transition font-arabic">
                            حذف
                        </button>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    },

    addKey: async function() {
        const nameInput = document.getElementById('new-key-name');
        const provSelect = document.getElementById('new-key-provider');
        const valueInput = document.getElementById('new-key-value');

        if (!nameInput || !valueInput) return;

        const friendlyName = nameInput.value.trim();
        const provider = provSelect.value;
        const apiKey = valueInput.value.trim();

        if (!friendlyName || !apiKey) {
            alert('يرجى ملء جميع الحقول المطلوبة.');
            return;
        }

        try {
            const response = await window.Dashboard.api.request('/api/providers/api-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ friendlyName, provider, apiKey })
            });
            const result = await response.json();

            if (result.success) {
                nameInput.value = '';
                valueInput.value = '';
                if (window.Dashboard.settings && window.Dashboard.settings.showToast) {
                    window.Dashboard.settings.showToast('تمت إضافة مفتاح الـ API بنجاح وجاري المزامنة بالخلفية!');
                }
                this.loadApiKeys();
            } else {
                alert('فشل إضافة المفتاح: ' + result.error);
            }
        } catch (err) {
            console.error('Failed to add key:', err);
            alert('حدث خطأ في الاتصال بالخادم.');
        }
    },

    toggleKey: async function(id, enabled) {
        try {
            const response = await window.Dashboard.api.request(`/api/providers/api-keys/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled })
            });
            const result = await response.json();
            if (result.success) {
                this.loadApiKeys();
            }
        } catch (err) {
            console.error(err);
        }
    },

    deleteKey: async function(id) {
        if (!confirm('هل أنت متأكد من رغبتك بحذف هذا المفتاح البرمجي بشكل نهائي؟')) return;
        try {
            const response = await window.Dashboard.api.request(`/api/providers/api-keys/${id}`, {
                method: 'DELETE'
            });
            const result = await response.json();
            if (result.success) {
                this.loadApiKeys();
            }
        } catch (err) {
            console.error(err);
        }
    },

    triggerRefresh: async function(id, btn) {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span>جاري التحديث...</span>';
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
                btn.innerHTML = '<span>تحديث يدوي</span>';
            }
        }
    }
};
