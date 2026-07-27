// Dashboard WhatsApp Channel Module supporting Multi-Provider Architectures
window.Dashboard = window.Dashboard || {};

window.Dashboard.whatsapp = {
    isSaving: false,

    showToast: function(message, type = 'success') {
        if (window.Dashboard.settings && window.Dashboard.settings.showToast) {
            window.Dashboard.settings.showToast(message, type);
        } else {
            console.log(`[WhatsApp Toast] [${type}]: ${message}`);
        }
    },

    fetchWhatsAppStatus: async function() {
        try {
            // Then query status
            const response = await window.Dashboard.api.request('/api/whatsapp/status');
            const data = await response.json();
            window.Dashboard.whatsapp.renderWhatsAppStatusDirect(data);
        } catch (err) {
            console.error('Failed to fetch WhatsApp status:', err.message);
        }
    },

    loadWhatsAppConfig: async function() {
        try {
            const response = await window.Dashboard.api.request('/api/whatsapp/config?tenantId=default');
            const data = await response.json();
            if (data.success) {
                const select = document.getElementById('wa-provider-select');
                if (select) {
                    select.value = data.providerType || 'web';
                }

                const config = data.config || {};
                const phoneIdInput = document.getElementById('wa-cloud-phone-id');
                const verifyTokenInput = document.getElementById('wa-cloud-verify-token');
                const tokenInput = document.getElementById('wa-cloud-token');
                const publicBackendUrlInput = document.getElementById('wa-cloud-public-backend-url');
                const webhookUrlInput = document.getElementById('wa-cloud-webhook-url');
                const warningContainer = document.getElementById('wa-cloud-webhook-warning');

                if (phoneIdInput) phoneIdInput.value = config.phoneNumberId || '';
                if (verifyTokenInput) verifyTokenInput.value = config.verifyToken || '';
                if (tokenInput) tokenInput.value = config.accessToken || '';
                if (publicBackendUrlInput) publicBackendUrlInput.value = data.publicBackendUrl || '';

                if (webhookUrlInput) {
                    if (data.webhookUrl) {
                        webhookUrlInput.value = data.webhookUrl;
                        webhookUrlInput.classList.remove('border-amber-300', 'bg-amber-50/50', 'text-amber-800');
                        if (warningContainer) {
                            warningContainer.classList.add('hidden');
                        }
                    } else {
                        webhookUrlInput.value = "⚠️ لم يتم ضبط عنوان السيرفر العام (Public Backend URL)";
                        webhookUrlInput.classList.add('border-amber-300', 'bg-amber-50/50', 'text-amber-800');
                        if (warningContainer) {
                            warningContainer.innerText = data.warning || "تحذير: يرجى إدخال عنوان السيرفر العام (Public Backend URL) لتوليد رابط استقبال الويب هوك بنجاح.";
                            warningContainer.classList.remove('hidden');
                        }
                    }
                }

                window.toggleWhatsAppProviderUI();
            }
        } catch (err) {
            console.error('Failed to load WhatsApp configuration:', err.message);
        }
    },

    toggleWhatsAppProviderUI: async function() {
        const select = document.getElementById('wa-provider-select');
        if (!select) return;

        const val = select.value;
        const webSection = document.getElementById('wa-web-config-section');
        const cloudSection = document.getElementById('wa-cloud-config-section');

        if (val === 'cloud') {
            if (webSection) webSection.classList.add('hidden');
            if (cloudSection) cloudSection.classList.remove('hidden');
        } else {
            if (webSection) webSection.classList.remove('hidden');
            if (cloudSection) cloudSection.classList.add('hidden');

            // If switching to web, automatically save/persist the provider selection to the backend
            if (window.Dashboard.whatsapp.isSaving) return;
            window.Dashboard.whatsapp.isSaving = true;
            try {
                const payload = {
                    tenantId: 'default',
                    providerType: 'web',
                    config: {}
                };
                const res = await window.Dashboard.api.request('/api/whatsapp/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const rData = await res.json();
                if (rData.success) {
                    window.Dashboard.whatsapp.showToast('تم التحويل إلى مزود واتساب ويب بنجاح!');
                    window.Dashboard.whatsapp.fetchWhatsAppStatus();
                }
            } catch (e) {
                console.error('Failed to switch provider to web:', e.message);
            } finally {
                window.Dashboard.whatsapp.isSaving = false;
            }
        }
    },

    saveWhatsAppCloudConfig: async function() {
        if (window.Dashboard.whatsapp.isSaving) return;

        const phoneId = document.getElementById('wa-cloud-phone-id')?.value.trim();
        const verifyToken = document.getElementById('wa-cloud-verify-token')?.value.trim();
        const token = document.getElementById('wa-cloud-token')?.value.trim();
        const publicBackendUrl = document.getElementById('wa-cloud-public-backend-url')?.value.trim();

        if (!phoneId || !verifyToken || !token) {
            window.Dashboard.whatsapp.showToast('الرجاء تعبئة كافة الحقول المطلوبة لربط بوابة الـ Cloud API.', 'error');
            return;
        }

        window.Dashboard.whatsapp.isSaving = true;

        try {
            // 1. Save Public Backend URL setting as system setting in DB
            const settingsPayload = {
                publicBackendUrl: publicBackendUrl || ""
            };
            await window.Dashboard.api.request('/api/config/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settingsPayload)
            });

            // 2. Save WhatsApp provider config
            const payload = {
                tenantId: 'default',
                providerType: 'cloud',
                config: {
                    phoneNumberId: phoneId,
                    verifyToken: verifyToken,
                    accessToken: token
                }
            };

            const response = await window.Dashboard.api.request('/api/whatsapp/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (data.success) {
                window.Dashboard.whatsapp.showToast('تم حفظ إعدادات WhatsApp Cloud وتفعيل البوابة بنجاح!');
                await window.Dashboard.whatsapp.loadWhatsAppConfig(); // Instant Callback URL regeneration and input reload!
                window.Dashboard.whatsapp.fetchWhatsAppStatus();
            } else {
                window.Dashboard.whatsapp.showToast(`فشل الحفظ: ${data.error || 'خطأ غير معروف'}`, 'error');
            }
        } catch (err) {
            window.Dashboard.whatsapp.showToast(`حدث خطأ أثناء حفظ الإعدادات: ${err.message}`, 'error');
        } finally {
            window.Dashboard.whatsapp.isSaving = false;
        }
    },

    copyCloudWebhookUrl: function() {
        const input = document.getElementById('wa-cloud-webhook-url');
        if (!input) return;

        input.select();
        input.setSelectionRange(0, 99999);

        navigator.clipboard.writeText(input.value)
            .then(() => window.Dashboard.whatsapp.showToast('تم نسخ رابط الـ Webhook بنجاح!'))
            .catch(() => window.Dashboard.whatsapp.showToast('فشل نسخ الرابط تلقائياً، يرجى نسخه يدوياً.', 'error'));
    },

    renderWhatsAppStatusDirect: function(data) {
        const badge = document.getElementById('wa-connection-badge');
        const sidebarBadge = document.getElementById('badge-wa-status');
        const container = document.getElementById('wa-qr-container');
        const logoutBtn = document.getElementById('wa-logout-btn');

        if (!badge || !container) return;

        badge.innerText = data.status.toUpperCase();

        const select = document.getElementById('wa-provider-select');
        const isCloud = select && select.value === 'cloud';

        if (data.status === "متصل") {
            badge.className = "text-[10px] px-3 py-1 rounded-full font-bold bg-green-100 text-green-700 uppercase";
            if (sidebarBadge) sidebarBadge.className = "w-1.5 h-1.5 rounded-full bg-green-500";
            if (logoutBtn) logoutBtn.classList.remove('hidden');

            if (isCloud) {
                container.innerHTML = `
                    <div class="text-center space-y-2">
                        <div class="font-bold text-green-600 uppercase tracking-widest text-[10px]">Cloud Gateway Active</div>
                        <p class="text-[9px] text-slate-400 mt-2">WhatsApp Cloud API is configured and ready</p>
                    </div>
                `;
            } else {
                container.innerHTML = `
                    <div class="text-center space-y-2">
                        <div class="font-bold text-green-600 uppercase tracking-widest text-[10px]">Web Gateway Active</div>
                        <p class="text-[9px] text-slate-400 mt-2">Ready for incoming traffic</p>
                    </div>
                `;
            }
        } else if (data.status === "انتظار المسح" && !isCloud) {
            badge.className = "text-[10px] px-3 py-1 rounded-full font-bold bg-yellow-100 text-yellow-700 uppercase";
            if (sidebarBadge) sidebarBadge.className = "w-1.5 h-1.5 rounded-full bg-yellow-500";
            if (logoutBtn) logoutBtn.classList.add('hidden');
            if (data.qr) {
                container.innerHTML = `
                    <div class="space-y-4">
                        <img src="${data.qr}" alt="WhatsApp QR Code" class="w-56 h-56 mx-auto border border-slate-200 p-2 bg-white rounded-lg shadow-sm">
                        <p class="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Scanning required...</p>
                    </div>
                `;
            }
        } else {
            badge.className = "text-[10px] px-3 py-1 rounded-full font-bold bg-red-100 text-red-700 uppercase";
            if (sidebarBadge) sidebarBadge.className = "w-1.5 h-1.5 rounded-full bg-red-500";
            if (logoutBtn) logoutBtn.classList.add('hidden');
            container.innerHTML = `<p class="text-[10px] text-red-500 uppercase tracking-wider">Gateway offline...</p>`;
        }
    },

    logoutWhatsApp: async function() {
        const select = document.getElementById('wa-provider-select');
        const isCloud = select && select.value === 'cloud';

        if (isCloud) {
            if (!confirm("هل تريد إيقاف وتعطيل اتصال بوابة الـ Cloud API؟")) return;
            try {
                // Switch back default tenant config to 'web' with empty config
                const payload = {
                    tenantId: 'default',
                    providerType: 'web',
                    config: {}
                };
                const response = await window.Dashboard.api.request('/api/whatsapp/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                if (result.success) {
                    window.Dashboard.whatsapp.showToast('تم فصل البوابة السحابية وإعادتها لوضع الويب.');
                    window.Dashboard.whatsapp.fetchWhatsAppStatus();
                }
            } catch (e) {
                window.Dashboard.whatsapp.showToast("حدث خطأ أثناء إلغاء التفعيل.", "error");
            }
            return;
        }

        if (!confirm("Terminate gateway connection?")) return;
        try {
            const response = await window.Dashboard.api.request('/api/whatsapp/logout', { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                window.Dashboard.whatsapp.showToast('WhatsApp connection terminated.');
                window.Dashboard.whatsapp.fetchWhatsAppStatus();
            }
        } catch (e) {
            window.Dashboard.whatsapp.showToast("حدث خطأ أثناء فصل الاتصال.", "error");
        }
    }
};

// Bind to global namespace for inline compatibility
window.fetchWhatsAppStatus = window.Dashboard.whatsapp.fetchWhatsAppStatus;
window.logoutWhatsApp = window.Dashboard.whatsapp.logoutWhatsApp;
window.toggleWhatsAppProviderUI = window.Dashboard.whatsapp.toggleWhatsAppProviderUI;
window.saveWhatsAppCloudConfig = window.Dashboard.whatsapp.saveWhatsAppCloudConfig;
window.copyCloudWebhookUrl = window.Dashboard.whatsapp.copyCloudWebhookUrl;
