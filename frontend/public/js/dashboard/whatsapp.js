// Dashboard WhatsApp Channel Module supporting Multi-Provider Architectures
window.Dashboard = window.Dashboard || {};

window.Dashboard.whatsapp = {
    isSaving: false,
    startupSyncTimer: null,

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
            const response = await window.Dashboard.api.request('/api/whatsapp/status', { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok || !data || typeof data.status !== 'string') {
                throw new Error(data?.error || `WhatsApp status unavailable (${response.status})`);
            }
            window.Dashboard.whatsapp.renderWhatsAppStatusDirect(data);
            return true;
        } catch (err) {
            console.error('Failed to fetch WhatsApp status:', err.message);
            return false;
        }
    },

    syncStatusOnStartup: function(attempt = 0) {
        if (this.startupSyncTimer) clearTimeout(this.startupSyncTimer);
        this.fetchWhatsAppStatus().then(success => {
            if (success || attempt >= 10) {
                this.startupSyncTimer = null;
                return;
            }
            this.startupSyncTimer = setTimeout(
                () => this.syncStatusOnStartup(attempt + 1),
                Math.min(1500 + (attempt * 500), 5000)
            );
        });
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

                // Loading saved configuration must only render the UI. Persisting
                // here restarted an already-connected WhatsApp Web client.
                window.Dashboard.whatsapp.toggleWhatsAppProviderUI(false);
            }
        } catch (err) {
            console.error('Failed to load WhatsApp configuration:', err.message);
        }
    },

    toggleWhatsAppProviderUI: async function(persistSelection = true) {
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

            if (!persistSelection) return;

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
        const settingsBadge = document.getElementById('badge-whatsapp');
        const container = document.getElementById('wa-qr-container');
        const logoutBtn = document.getElementById('wa-logout-btn');

        if (badge) badge.innerText = data.status.toUpperCase();

        const select = document.getElementById('wa-provider-select');
        const isCloud = select && select.value === 'cloud';

        if (data.status === "متصل") {
            if (badge) badge.className = "text-[12px] px-3 py-1 rounded-full font-bold bg-green-100 text-green-700 uppercase";
            if (sidebarBadge) sidebarBadge.className = "w-1.5 h-1.5 rounded-full bg-green-500";
            if (settingsBadge) {
                settingsBadge.innerText = 'متصل';
                settingsBadge.className = 'badge-status active';
            }
            if (logoutBtn) logoutBtn.classList.remove('hidden');

            if (container && isCloud) {
                container.replaceChildren(this.createStatusMessage('Cloud Gateway Active', 'WhatsApp Cloud API is configured and ready'));
            } else if (container) {
                container.replaceChildren(this.createStatusMessage('Web Gateway Active', 'Ready for incoming traffic'));
            }
        } else if (data.status === "انتظار المسح" && !isCloud) {
            if (badge) badge.className = "text-[12px] px-3 py-1 rounded-full font-bold bg-yellow-100 text-yellow-700 uppercase";
            if (sidebarBadge) sidebarBadge.className = "w-1.5 h-1.5 rounded-full bg-yellow-500";
            if (settingsBadge) {
                settingsBadge.innerText = 'غير مكتمل';
                settingsBadge.className = 'badge-status warning';
            }
            if (logoutBtn) logoutBtn.classList.add('hidden');
            if (container && data.qr) {
                const wrapper = window.Dashboard.utils.createElement('div', { className: 'space-y-4' });
                const image = window.Dashboard.utils.createElement('img', {
                    className: 'w-56 h-56 mx-auto border border-slate-200 p-2 bg-white rounded-lg shadow-sm',
                    attributes: { alt: 'WhatsApp QR Code' }
                });
                if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(data.qr))) {
                    image.src = data.qr;
                }
                wrapper.append(image, window.Dashboard.utils.createElement('p', {
                    className: 'text-[12px] text-slate-400 uppercase tracking-wider font-semibold',
                    text: 'Scanning required...'
                }));
                container.replaceChildren(wrapper);
            }
        } else {
            if (badge) badge.className = "text-[12px] px-3 py-1 rounded-full font-bold bg-red-100 text-red-700 uppercase";
            if (sidebarBadge) sidebarBadge.className = "w-1.5 h-1.5 rounded-full bg-red-500";
            if (settingsBadge) {
                settingsBadge.innerText = 'غير متصل';
                settingsBadge.className = 'badge-status danger';
            }
            if (logoutBtn) logoutBtn.classList.add('hidden');
            if (container) container.replaceChildren(window.Dashboard.utils.createElement('p', {
                className: 'text-[12px] text-red-500 uppercase tracking-wider',
                text: 'Gateway offline...'
            }));
        }
    },

    createStatusMessage: function(title, detail) {
        const wrapper = window.Dashboard.utils.createElement('div', { className: 'text-center space-y-2' });
        wrapper.append(
            window.Dashboard.utils.createElement('div', {
                className: 'font-bold text-green-600 uppercase tracking-widest text-[12px]',
                text: title
            }),
            window.Dashboard.utils.createElement('p', {
                className: 'text-[12px] text-slate-400 mt-2',
                text: detail
            })
        );
        return wrapper;
    },

    logoutWhatsApp: async function() {
        const select = document.getElementById('wa-provider-select');
        const isCloud = select && select.value === 'cloud';

        if (isCloud) {
            if (!await window.Dashboard.feedback.confirm({
                title: 'فصل قناة WhatsApp Cloud',
                description: 'سيتم فصل القناة السحابية وقد يتوقف استقبال رسائل WhatsApp حتى إعادة ربطها.',
                confirmLabel: 'فصل القناة',
                destructive: true
            })) return;
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

        if (!await window.Dashboard.feedback.confirm({
            title: 'فصل اتصال WhatsApp',
            description: 'سيتم إنهاء جلسة WhatsApp الحالية وقد يتوقف استقبال الرسائل حتى مسح الرمز وإعادة الربط.',
            confirmLabel: 'إنهاء الاتصال',
            destructive: true
        })) return;
        try {
            const response = await window.Dashboard.api.request('/api/whatsapp/logout', { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                window.Dashboard.whatsapp.showToast('تم إنهاء اتصال WhatsApp.');
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
