// Dashboard Composer and Direct Message Dispatcher Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.composer = {
    mediaCapabilities: null,
    init: function() {
        const bindings = [
            ['tab-reply', 'click', () => this.setMessageType('reply')],
            ['tab-note', 'click', () => this.setMessageType('note')],
            ['media-preview-delete', 'click', () => this.clearMediaUpload()],
            ['media-upload-btn', 'click', () => this.triggerFileInput()],
            ['media-upload-input', 'change', () => this.handleFileSelection()],
            ['media-retry-btn', 'click', () => this.retryMediaSend()],
            ['send-btn', 'click', () => this.sendDirectMessage()]
        ];
        bindings.forEach(([id, eventName, listener]) => {
            const element = document.getElementById(id);
            if (element) element.addEventListener(eventName, listener);
        });
        const input = document.getElementById('direct-msg-input');
        if (input) {
            input.addEventListener('keyup', event => this.handleInputKey(event));
            input.addEventListener('input', () => this.detectCannedResponseTrigger(input));
        }
        const dropZone = document.getElementById('input-wrapper');
        if (dropZone) {
            ['dragenter', 'dragover'].forEach(name => dropZone.addEventListener(name, event => {
                event.preventDefault();
                dropZone.classList.add('ring-2', 'ring-blue-400', 'rounded-lg');
            }));
            ['dragleave', 'drop'].forEach(name => dropZone.addEventListener(name, event => {
                event.preventDefault();
                dropZone.classList.remove('ring-2', 'ring-blue-400', 'rounded-lg');
            }));
            dropZone.addEventListener('drop', event => {
                const file = event.dataTransfer?.files?.[0];
                if (file) this.setSelectedFile(file);
            });
        }
    },

    triggerFileInput: function() {
        const input = document.getElementById('media-upload-input');
        if (input) input.click();
    },

    handleFileSelection: function() {
        const input = document.getElementById('media-upload-input');
        if (input && input.files && input.files.length > 0) {
            this.setSelectedFile(input.files[0]);
        }
    },

    setSelectedFile: function(file) {
        const user = window.Dashboard.state.usersCache.find(
            item => String(item.id) === String(window.Dashboard.state.selectedUserId)
        );
        const capability = user && this.mediaCapabilities?.[user.platform];
        if (!user || !capability) {
            window.Dashboard.settings.showToast('إرسال الوسائط غير متاح لهذه القناة حالياً.', 'error');
            return;
        }
        if (!capability.mimeTypes.includes(String(file.type || '').toLowerCase())) {
            window.Dashboard.settings.showToast('نوع الملف غير مدعوم على القناة المحددة.', 'error');
            return;
        }
        if (file.size > capability.maxBytes) {
            window.Dashboard.settings.showToast('حجم الملف يتجاوز حد القناة.', 'error');
            return;
        }
        window.Dashboard.state.selectedMediaFile = file;
        window.Dashboard.state.mediaIdempotencyKey = globalThis.crypto?.randomUUID
            ? globalThis.crypto.randomUUID()
            : `media-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        window.Dashboard.state.failedMediaAttachmentId = null;
        const previewContainer = document.getElementById('media-preview-container');
        const filenameSpan = document.getElementById('media-filename');
        const thumbnail = document.getElementById('media-thumbnail');
        if (filenameSpan) filenameSpan.textContent = file.name;
        if (thumbnail) {
            thumbnail.replaceChildren();
            if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
                const preview = document.createElement(file.type.startsWith('image/') ? 'img' : 'video');
                preview.src = URL.createObjectURL(file);
                preview.className = 'w-full h-full object-cover';
                if (preview.tagName === 'VIDEO') preview.muted = true;
                thumbnail.appendChild(preview);
                thumbnail.classList.remove('hidden');
            } else {
                thumbnail.classList.add('hidden');
            }
        }
        this.setUploadProgress(0, 'جاهز للإرسال');
        document.getElementById('media-retry-btn')?.classList.add('hidden');
        previewContainer?.classList.remove('hidden');
    },

    applyChannelCapabilities: async function(channel) {
        if (!this.mediaCapabilities) {
            try {
                const response = await window.Dashboard.api.request('/api/media/capabilities');
                const result = await response.json();
                if (result.success) this.mediaCapabilities = result.capabilities;
            } catch (_) {
                this.mediaCapabilities = {};
            }
        }
        const capability = this.mediaCapabilities?.[channel];
        const input = document.getElementById('media-upload-input');
        const button = document.getElementById('media-upload-btn');
        if (button) button.classList.toggle('hidden', !capability);
        if (input) input.accept = capability ? capability.mimeTypes.join(',') : '';
        const selected = window.Dashboard.state.selectedMediaFile;
        if (selected && (!capability || !capability.mimeTypes.includes(selected.type))) {
            this.clearMediaUpload();
        }
    },

    setUploadProgress: function(percent, status, isError = false) {
        const bar = document.getElementById('media-upload-progress');
        const label = document.getElementById('media-upload-status');
        if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        if (label) {
            label.textContent = status;
            label.className = `block text-[12px] mt-1 ${isError ? 'text-red-600' : 'text-slate-500'}`;
        }
    },

    clearMediaUpload: function() {
        if (this.activeAbortController) this.activeAbortController.abort();
        if (this.activeXhr) this.activeXhr.abort();
        this.activeAbortController = null;
        this.activeXhr = null;
        window.Dashboard.state.selectedMediaFile = null;
        window.Dashboard.state.mediaIdempotencyKey = null;
        const input = document.getElementById('media-upload-input');
        if (input) input.value = "";
        const previewContainer = document.getElementById('media-preview-container');
        if (previewContainer) previewContainer.classList.add('hidden');
        document.getElementById('media-retry-btn')?.classList.add('hidden');
        this.setUploadProgress(0, 'جاهز للإرسال');
    },

    setMessageType: function(type) {
        window.Dashboard.state.currentMessageType = type;
        const tabReply = document.getElementById('tab-reply');
        const tabNote = document.getElementById('tab-note');
        const input = document.getElementById('direct-msg-input');
        const sendBtn = document.getElementById('send-btn');

        if (!input || !sendBtn) return;

        if (type === 'note') {
            if (tabNote) tabNote.className = "text-amber-600 border-b-2 border-amber-500 pb-1.5 transition";
            if (tabReply) tabReply.className = "text-slate-400 hover:text-slate-600 pb-1.5 transition";
            input.placeholder = "اكتب ملاحظة داخلية سرية هنا... لن تظهر للعميل.";
            input.className = "flex-1 p-3 border border-amber-200 bg-amber-50/50 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 transition";
            sendBtn.className = "bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 px-6 rounded-lg text-xs transition shadow-sm font-cairo";
            sendBtn.innerText = "حفظ الملاحظة";
        } else {
            if (tabReply) tabReply.className = "text-blue-600 border-b-2 border-blue-600 pb-1.5 transition";
            if (tabNote) tabNote.className = "text-slate-400 hover:text-slate-600 pb-1.5 transition";
            const selectedUser = window.Dashboard.state.usersCache.find(
                user => String(user.id) === String(window.Dashboard.state.selectedUserId)
            );
            input.placeholder = selectedUser
                ? window.Dashboard.chatThemes.get(selectedUser.platform).composerPlaceholder
                : "اكتب ردك هنا... اكتب / لعرض الردود الجاهزة";
            input.className = "flex-1 p-3 border border-slate-200 bg-white rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-600 transition";
            sendBtn.className = "bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg text-xs transition shadow-sm font-cairo";
            sendBtn.innerText = "إرسال";
        }
    },

    detectCannedResponseTrigger: function(element) {
        const val = element.value;
        const overlay = document.getElementById('canned-responses-overlay');
        if (!overlay) return;

        if (val.startsWith('/')) {
            const searchTxt = val.slice(1).toLowerCase();
            const matched = window.Dashboard.state.cannedResponses.filter(r => r.trigger.includes(searchTxt));

            if (matched.length > 0) {
                const dom = window.Dashboard.utils;
                const rows = matched.map(resp => {
                    const row = dom.createElement('div', {
                        className: 'p-3 hover:bg-slate-50 cursor-pointer text-xs flex justify-between items-center transition'
                    });
                    row.addEventListener('click', () => window.Dashboard.composer.selectCannedResponse(resp.text));
                    row.append(
                        dom.createElement('span', { className: 'font-bold text-slate-800', text: resp.text }),
                        dom.createElement('span', {
                            className: 'text-[12px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono font-bold',
                            text: `/${resp.trigger}`
                        })
                    );
                    return row;
                });
                overlay.replaceChildren(...rows);
                overlay.classList.remove('hidden');
            } else {
                overlay.classList.add('hidden');
            }
        } else {
            overlay.classList.add('hidden');
        }
    },

    selectCannedResponse: function(text) {
        const input = document.getElementById('direct-msg-input');
        if (input) {
            input.value = text;
            const overlay = document.getElementById('canned-responses-overlay');
            if (overlay) overlay.classList.add('hidden');
            input.focus();
        }
    },

    handleInputKey: function(event) {
        if (event.key === "Enter") {
            window.Dashboard.composer.sendDirectMessage();
        }
    },

    sendDirectMessage: async function() {
        const input = document.getElementById('direct-msg-input');
        const sendBtn = document.getElementById('send-btn');
        if (!input) return;
        const message = input.value.trim();

        // Ensure there is either text content or an attachment
        if (!message && !window.Dashboard.state.selectedMediaFile) return;

        try {
            if (sendBtn) sendBtn.disabled = true;
            const selectedUser = window.Dashboard.state.usersCache.find(
                user => String(user.id) === String(window.Dashboard.state.selectedUserId)
            );
            let payload = {
                userId: window.Dashboard.state.selectedUserId,
                tenantId: selectedUser ? selectedUser.tenantId : undefined
            };

            if (window.Dashboard.state.selectedMediaFile) {
                const file = window.Dashboard.state.selectedMediaFile;
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result || ''));
                    reader.onerror = () => reject(new Error('تعذر قراءة الملف المرفق.'));
                    reader.onprogress = event => {
                        if (event.lengthComputable) {
                            this.setUploadProgress(Math.round((event.loaded / event.total) * 35), 'جاري تجهيز الملف...');
                        }
                    };
                    reader.readAsDataURL(file);
                });
                const separatorIndex = dataUrl.indexOf(',');
                if (separatorIndex < 0) throw new Error('تعذر ترميز الملف المرفق.');
                payload.message = message;
                payload.mediaData = dataUrl.slice(separatorIndex + 1);
                payload.mediaName = file.name;
                payload.mediaType = file.type;
                payload.idempotencyKey = window.Dashboard.state.mediaIdempotencyKey;
            } else {
                payload.message = message;
            }

            if (window.Dashboard.state.currentMessageType === 'note') {
                payload.isNote = true;
            }

            let result;
            if (window.Dashboard.state.selectedMediaFile) {
                result = await this.sendPayloadWithUploadProgress(payload);
            } else {
                const response = await window.Dashboard.api.request('/api/send-direct', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: (this.activeAbortController = new AbortController()).signal
                });
                result = await response.json();
            }
            if (result.success) {
                if (result.managementRequested === false && selectedUser) {
                    window.Dashboard.chat.clearManagementEscalationUI(selectedUser);
                    window.Dashboard.analytics.fetchStatsAndUsers();
                }
                this.setUploadProgress(100, 'تم الإرسال');
                input.value = '';
                window.Dashboard.composer.clearMediaUpload();
                window.Dashboard.composer.setMessageType('reply');
                await window.Dashboard.chat.fetchChatHistory();
            } else {
                if (result.attachmentId) {
                    window.Dashboard.state.failedMediaAttachmentId = result.attachmentId;
                    document.getElementById('media-retry-btn')?.classList.remove('hidden');
                }
                throw new Error(result.error || 'فشل إرسال الرسالة.');
            }
        } catch (err) {
            if (err.name !== 'AbortError') this.setUploadProgress(100, err.message || 'فشل الإرسال', true);
            window.Dashboard.settings.showToast(
                `فشل إرسال الرسالة: ${err.message || 'خطأ غير معروف'}`,
                'error'
            );
        } finally {
            this.activeAbortController = null;
            this.activeXhr = null;
            if (sendBtn) sendBtn.disabled = false;
        }
    },

    sendPayloadWithUploadProgress: async function(payload) {
        if (!window.Dashboard.api.csrfToken) {
            await window.Dashboard.api.fetchCsrfToken();
        }
        const url = window.Dashboard.api.resolveUrl('/api/send-direct');
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            this.activeXhr = xhr;
            xhr.open('POST', url);
            xhr.withCredentials = true;
            xhr.setRequestHeader('Content-Type', 'application/json');
            if (window.Dashboard.api.csrfToken) {
                xhr.setRequestHeader('X-CSRF-Token', window.Dashboard.api.csrfToken);
            }
            const sessionId = localStorage.getItem('futh_session_id');
            if (sessionId) xhr.setRequestHeader('X-Session-ID', sessionId);
            xhr.upload.addEventListener('progress', event => {
                if (event.lengthComputable) {
                    const percent = 35 + Math.round((event.loaded / event.total) * 50);
                    this.setUploadProgress(percent, `جاري الرفع... ${Math.round((event.loaded / event.total) * 100)}%`);
                }
            });
            xhr.addEventListener('load', () => {
                let result;
                try {
                    result = JSON.parse(xhr.responseText || '{}');
                } catch (_) {
                    return reject(new Error('استجابة الخادم غير صالحة.'));
                }
                if (xhr.status === 401) {
                    window.location.href = '/login';
                    return reject(new Error('انتهت جلسة الدخول.'));
                }
                resolve(result);
            });
            xhr.addEventListener('error', () => reject(new Error('فشل اتصال رفع الملف.')));
            xhr.addEventListener('abort', () => {
                const error = new Error('تم إلغاء رفع الملف.');
                error.name = 'AbortError';
                reject(error);
            });
            xhr.send(JSON.stringify(payload));
        });
    },

    retryMediaSend: async function() {
        const attachmentId = window.Dashboard.state.failedMediaAttachmentId;
        if (!attachmentId) return;
        try {
            this.setUploadProgress(35, 'جاري إعادة المحاولة...');
            const response = await window.Dashboard.api.request(
                `/api/media/${encodeURIComponent(attachmentId)}/retry`,
                { method: 'POST' }
            );
            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'فشلت إعادة المحاولة.');
            const selectedUser = window.Dashboard.state.usersCache.find(
                user => String(user.id) === String(window.Dashboard.state.selectedUserId)
            );
            if (result.managementRequested === false && selectedUser) {
                window.Dashboard.chat.clearManagementEscalationUI(selectedUser);
                window.Dashboard.analytics.fetchStatsAndUsers();
            }
            this.setUploadProgress(100, 'تم الإرسال');
            await window.Dashboard.chat.fetchChatHistory();
            setTimeout(() => this.clearMediaUpload(), 500);
        } catch (error) {
            this.setUploadProgress(100, error.message || 'فشلت إعادة المحاولة.', true);
        }
    }
};

// Bind to global namespace for inline compatibility
window.triggerFileInput = window.Dashboard.composer.triggerFileInput;
window.handleFileSelection = window.Dashboard.composer.handleFileSelection;
window.clearMediaUpload = window.Dashboard.composer.clearMediaUpload;
window.setMessageType = window.Dashboard.composer.setMessageType;
window.detectCannedResponseTrigger = window.Dashboard.composer.detectCannedResponseTrigger;
window.selectCannedResponse = window.Dashboard.composer.selectCannedResponse;
window.handleInputKey = window.Dashboard.composer.handleInputKey;
window.sendDirectMessage = window.Dashboard.composer.sendDirectMessage;
