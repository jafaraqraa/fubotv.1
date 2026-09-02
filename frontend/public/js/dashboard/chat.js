// Unified, channel-themed conversation renderer.
window.Dashboard = window.Dashboard || {};

window.Dashboard.chat = {
    currentMessages: [],
    visibleMessageLimit: 100,
    requestSequence: 0,
    lastRenderFingerprint: '',
    focusManagementEscalation: false,
    mobileListScrollTop: 0,

    init: function() {
        const chatBox = document.getElementById('chat-box');
        if (!chatBox) return;
        chatBox.addEventListener('scroll', () => {
            if (chatBox.scrollTop > 40 || this.visibleMessageLimit >= this.currentMessages.length) return;
            const previousHeight = chatBox.scrollHeight;
            this.visibleMessageLimit += 100;
            const user = window.Dashboard.state.usersCache.find(
                item => String(item.id) === String(window.Dashboard.state.selectedUserId)
            );
            this.renderMessageList(this.currentMessages, user ? user.platform : 'messenger');
            chatBox.scrollTop = chatBox.scrollHeight - previousHeight;
        }, { passive: true });
    },

    selectUser: async function(userId) {
        window.Dashboard.state.selectedUserId = userId;
        const user = window.Dashboard.state.usersCache.find(item => String(item.id) === String(userId));
        if (!user) return;

        this.focusManagementEscalation = window.Dashboard.state.currentChatFilter === 'management';

        const theme = window.Dashboard.chatThemes.apply(user.platform);
        this.visibleMessageLimit = 100;
        this.lastRenderFingerprint = '';
        this.renderConversationHeader(user, theme);
        this.configureConversationControls(user);
        this.showConversationOnMobile();
        await this.fetchChatHistory();
    },

    renderConversationHeader: function(user, theme) {
        const dom = window.Dashboard.utils;
        const headerInfo = document.getElementById('chat-user-header-info');
        if (headerInfo) {
            const avatar = dom.createCustomerAvatar(
                user,
                'channel-avatar',
                String(user.name || theme.avatar).slice(0, 2).toUpperCase()
            );
            const identity = dom.createElement('div', { className: 'channel-header-identity' });
            identity.append(
                dom.createElement('strong', { className: 'channel-header-name', text: user.name }),
                dom.createElement('span', { className: 'channel-header-status', text: theme.statusLabel })
            );
            headerInfo.replaceChildren(avatar, identity);
        }

        const currentId = document.getElementById('current-chat-id');
        if (currentId) currentId.textContent = `ID: ${user.id}`;

        const actions = document.getElementById('chat-header-actions');
        if (actions) {
            const search = dom.createElement('button', {
                className: 'channel-icon-button',
                text: '⌕',
                attributes: { type: 'button', title: 'بحث في المحادثة', 'aria-label': 'بحث في المحادثة' }
            });
            search.addEventListener('click', () => this.toggleSearch());

            const assignmentStatus = dom.createElement('span', {
                className: 'text-[12px] font-bold px-2 py-1 rounded-lg bg-blue-50 text-blue-700',
                text: user.isAIEnabled ? 'مسند للذكاء الصناعي' : 'رد يدوي'
            });
            const managementActions = [];
            if (user.managementRequested) {
                managementActions.push(
                    dom.createElement('span', {
                        className: 'text-[12px] font-bold px-2 py-1 rounded-lg bg-violet-100 text-violet-700',
                        text: '🔔 طلب إدارة'
                    })
                );
                const resolveButton = dom.createElement('button', {
                    className: 'channel-automation-button management-resolve-button',
                    text: 'تمت المعالجة — إبقاء AI',
                    attributes: { type: 'button', title: 'إنهاء إشعار الإدارة وإسناد المحادثة للذكاء الصناعي' }
                });
                resolveButton.addEventListener('click', () => this.resolveManagementRequest(user));
                managementActions.push(resolveButton);
            }

            if (user.platform === 'instagram' && user.capabilities && user.capabilities.calls) {
                actions.replaceChildren(
                    this.createHeaderIcon('☎', 'مكالمة'),
                    this.createHeaderIcon('▣', 'مكالمة فيديو'),
                    assignmentStatus,
                    ...managementActions,
                    search,
                    this.createAutomationButton(user),
                    this.createDeleteButton(user)
                );
            } else {
                actions.replaceChildren(
                    assignmentStatus,
                    ...managementActions,
                    search,
                    this.createAutomationButton(user),
                    this.createDeleteButton(user)
                );
            }
        }
    },

    resolveManagementRequest: async function(user) {
        try {
            const response = await window.Dashboard.api.request('/api/chat/management/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.id, tenantId: user.tenantId })
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'تعذر إنهاء الطلب');
            user.assignee = 'ai';
            user.isAIEnabled = true;
            this.clearManagementEscalationUI(user);
            window.Dashboard.analytics.fetchStatsAndUsers();
            window.Dashboard.settings.showToast('تمت معالجة طلب الإدارة وبقيت المحادثة مسندة للذكاء الصناعي.');
        } catch (error) {
            window.Dashboard.settings.showToast(error.message || 'تعذر إنهاء طلب الإدارة.', 'error');
        }
    },

    clearManagementEscalationUI: function(user) {
        if (!user) return;
        user.managementRequested = false;
        this.focusManagementEscalation = false;
        this.currentMessages = this.currentMessages.map(message => {
            if (!message.metadata || !message.metadata.managementEscalation) return message;
            return {
                ...message,
                metadata: {
                    ...message.metadata,
                    managementEscalation: false
                }
            };
        });
        this.lastRenderFingerprint = '';
        this.renderConversationHeader(user, window.Dashboard.chatThemes.apply(user.platform));
        this.renderMessageList(this.currentMessages, user.platform);
        window.Dashboard.users.renderUsersList();
    },

    createHeaderIcon: function(text, label) {
        return window.Dashboard.utils.createElement('button', {
            className: 'channel-icon-button',
            text,
            attributes: { type: 'button', title: label, 'aria-label': label }
        });
    },

    createAutomationButton: function(user) {
        const button = window.Dashboard.utils.createElement('button', {
            className: 'channel-automation-button',
            text: user.isAIEnabled ? 'إيقاف AI' : 'تفعيل AI',
            attributes: { type: 'button' }
        });
        button.addEventListener('click', () => {
            window.Dashboard.conversationControls.openConfirmModal(user.id, user.name, user.isAIEnabled);
        });
        return button;
    },

    createDeleteButton: function(user) {
        const button = window.Dashboard.utils.createElement('button', {
            className: 'channel-icon-button is-destructive',
            text: '🗑',
            attributes: {
                type: 'button',
                title: 'حذف المحادثة',
                'aria-label': `حذف محادثة ${user.name || 'العميل'}`
            }
        });
        button.addEventListener('click', () => this.confirmDeleteConversation(user, button));
        return button;
    },

    confirmDeleteConversation: async function(user, trigger) {
        if (!user?.conversationId) {
            window.Dashboard.feedback.notify('تعذّر تحديد المحادثة.', 'error');
            return;
        }
        const confirmed = await window.Dashboard.feedback.confirm({
            title: 'حذف المحادثة؟',
            description: `سيتم حذف محادثة ${user.name || 'هذا العميل'} وجميع رسائلها ومرفقاتها نهائياً.`,
            confirmLabel: 'حذف المحادثة',
            cancelLabel: 'إلغاء',
            destructive: true
        });
        if (!confirmed) return;
        trigger.disabled = true;
        try {
            const response = await window.Dashboard.api.request(`/api/conversations/${encodeURIComponent(user.conversationId)}`, {
                method: 'DELETE'
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'تعذر حذف المحادثة');
            this.handleConversationDeleted(user.conversationId, user.id);
            window.Dashboard.feedback.notify('تم حذف المحادثة.');
            window.Dashboard.analytics.fetchStatsAndUsers();
        } catch (error) {
            trigger.disabled = false;
            window.Dashboard.feedback.notify(error.message || 'تعذر حذف المحادثة.', 'error');
        }
    },

    handleConversationDeleted: function(conversationId, userId) {
        window.Dashboard.state.usersCache = window.Dashboard.state.usersCache.filter(user =>
            String(user.conversationId) !== String(conversationId)
        );
        if (String(window.Dashboard.state.selectedUserId) === String(userId)) {
            window.Dashboard.state.selectedUserId = null;
            this.currentMessages = [];
            this.requestSequence += 1;
            document.getElementById('chat-user-header-info')?.replaceChildren(
                window.Dashboard.utils.createElement('div', { text: 'اختر محادثة للبدء' })
            );
            document.getElementById('chat-box')?.replaceChildren(
                window.Dashboard.utils.createElement('p', {
                    className: 'text-slate-400 text-center my-auto text-[12px]',
                    text: 'اختر محادثة لعرض الرسائل'
                })
            );
            document.getElementById('assignee-container')?.classList.add('hidden');
            document.getElementById('chat-header-actions')?.replaceChildren();
            ['direct-msg-input', 'send-btn', 'media-upload-btn'].forEach(id => {
                const element = document.getElementById(id);
                if (element) element.disabled = true;
            });
            this.closeConversationOnMobile();
        }
        window.Dashboard.users.renderUsersList();
    },

    configureConversationControls: function(user) {
        const assignee = document.getElementById('assignee-container');
        if (assignee) assignee.classList.remove('hidden');
        const select = document.getElementById('chat-assignee-select');
        if (select) select.value = user.isAIEnabled ? 'ai' : (user.assignee || 'ai');
        ['direct-msg-input', 'send-btn', 'media-upload-btn'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.removeAttribute('disabled');
        });
        window.Dashboard.composer.applyChannelCapabilities(user.platform);
    },

    assignChat: async function(userId, assignee) {
        if (!userId) return;
        const select = document.getElementById('chat-assignee-select');
        const user = window.Dashboard.state.usersCache.find(item => String(item.id) === String(userId));
        const previousAssignee = user ? (user.isAIEnabled ? 'ai' : (user.assignee || 'ai')) : 'ai';
        if (select) select.disabled = true;
        try {
            const response = await window.Dashboard.api.request('/api/chat/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, assignee, tenantId: user ? user.tenantId : undefined })
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'تعذر تغيير الإسناد');
            if (!user) return;
            user.assignee = assignee;
            user.isAIEnabled = result.isAIEnabled === true;
            if (select) select.value = assignee;
            this.renderConversationHeader(user, window.Dashboard.chatThemes.apply(user.platform));
            window.Dashboard.users.renderUsersList();
            window.Dashboard.analytics.fetchStatsAndUsers();
            window.Dashboard.settings.showToast(
                assignee === 'ai' ? 'تم إسناد المحادثة لوكيل الذكاء الاصطناعي.' : 'تم تغيير إسناد المحادثة بنجاح.'
            );
        } catch (error) {
            console.error('Unable to assign conversation:', error);
            if (select) select.value = previousAssignee;
            window.Dashboard.settings.showToast(error.message || 'تعذر تغيير الإسناد.', 'error');
        } finally {
            if (select) select.disabled = false;
        }
    },

    fetchChatHistory: async function() {
        const selectedUserId = window.Dashboard.state.selectedUserId;
        if (!selectedUserId) return;
        const sequence = ++this.requestSequence;
        const selectedUser = window.Dashboard.state.usersCache.find(
            user => String(user.id) === String(selectedUserId)
        );
        if (!selectedUser) return;

        try {
            const tenantQuery = selectedUser.tenantId
                ? `?tenantId=${encodeURIComponent(selectedUser.tenantId)}`
                : '';
            const response = await window.Dashboard.api.request(
                `/api/chat/${encodeURIComponent(selectedUserId)}${tenantQuery}`,
                { cache: 'no-store' }
            );
            const messages = await response.json();
            if (sequence !== this.requestSequence || !Array.isArray(messages)) return;
            const fingerprint = JSON.stringify(messages);
            if (fingerprint === this.lastRenderFingerprint) return;
            this.lastRenderFingerprint = fingerprint;
            this.currentMessages = messages;
            this.renderMessageList(messages, selectedUser.platform);
        } catch (error) {
            console.error('Unable to load conversation:', error);
        }
    },

    renderMessageList: function(messages, channel) {
        const chatBox = document.getElementById('chat-box');
        if (!chatBox) return;
        const wasNearBottom = chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < 80;
        if (this.focusManagementEscalation) {
            const escalationIndex = messages.findLastIndex(
                message => message.metadata && message.metadata.managementEscalation
            );
            if (escalationIndex >= 0) {
                this.visibleMessageLimit = Math.max(
                    this.visibleMessageLimit,
                    messages.length - escalationIndex + 20
                );
            }
        }
        const visible = messages.slice(-this.visibleMessageLimit);
        const nodes = [];
        let previous = null;
        let currentDate = '';

        visible.forEach(message => {
            const date = this.messageDateLabel(message);
            if (date && date !== currentDate) {
                nodes.push(this.createDateSeparator(date));
                currentDate = date;
            }
            if (message.metadata && message.metadata.unreadDivider) {
                nodes.push(this.createUnreadDivider());
            }
            const grouped = previous &&
                previous.sender === message.sender &&
                !(previous.metadata && previous.metadata.unreadDivider);
            nodes.push(this.createMessageElement(message, channel, grouped));
            previous = message;
        });

        if (nodes.length === 0) {
            nodes.push(window.Dashboard.utils.createElement('p', {
                className: 'channel-empty-state',
                text: 'لا توجد رسائل سابقة'
            }));
        }
        chatBox.replaceChildren(...nodes);
        if (wasNearBottom || messages.length <= this.visibleMessageLimit) {
            chatBox.querySelectorAll('.message-media-frame.is-loading').forEach(frame => {
                frame.dataset.stickToBottom = 'true';
            });
        }
        const escalationTarget = this.focusManagementEscalation
            ? chatBox.querySelector('.is-management-escalation:last-of-type')
            : null;
        if (escalationTarget) {
            escalationTarget.scrollIntoView({ block: 'center', behavior: 'smooth' });
            this.focusManagementEscalation = false;
        } else if (wasNearBottom || messages.length <= this.visibleMessageLimit) {
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    },

    createMessageElement: function(message, channel, grouped = false) {
        const dom = window.Dashboard.utils;
        if (message.type === 'note' || message.isNote) return this.createInternalNote(message);
        if (message.type === 'typing') return this.createTypingIndicator(channel);

        const outgoing = message.sender === 'admin' || message.sender === 'ai' || message.sender === 'agent';
        const wrapper = dom.createElement('article', {
            className: `channel-message ${outgoing ? 'is-outgoing' : 'is-incoming'} ${grouped ? 'is-grouped' : ''}`
        });
        if (message.id) wrapper.dataset.messageId = String(message.id);
        if (message.metadata && message.metadata.managementEscalation) {
            wrapper.classList.add('is-management-escalation');
        }
        wrapper.dataset.messageType = String(message.type || 'text');

        if (!outgoing && !grouped && (channel === 'telegram' || channel === 'messenger' || channel === 'instagram')) {
            wrapper.appendChild(dom.createElement('div', { className: 'message-avatar', text: '•' }));
        }

        const stack = dom.createElement('div', { className: 'message-stack' });
        const bubble = dom.createElement('div', { className: 'channel-bubble' });
        const metadata = message.metadata || {};

        if (metadata.forwarded && channel === 'telegram') {
            bubble.appendChild(dom.createElement('div', { className: 'message-forwarded', text: 'Forwarded message' }));
        }
        if (metadata.reply) bubble.appendChild(this.createReplyPreview(metadata.reply));
        bubble.appendChild(this.createMessageContent(message, channel));

        const footer = dom.createElement('div', { className: 'message-footer' });
        footer.appendChild(dom.createElement('time', { className: 'message-time', text: message.time || '' }));
        if (outgoing) footer.appendChild(this.createMessageStatus(message.deliveryStatus, channel));
        bubble.appendChild(footer);
        stack.appendChild(bubble);

        if (Array.isArray(metadata.reactions) && metadata.reactions.length) {
            stack.appendChild(this.createReactionBar(metadata.reactions));
        }
        if (channel === 'instagram' && outgoing && metadata.seen) {
            stack.appendChild(dom.createElement('span', { className: 'instagram-seen', text: 'Seen' }));
        }

        const menuButton = dom.createElement('button', {
            className: 'message-menu-trigger',
            text: '⋮',
            attributes: { type: 'button', 'aria-label': 'خيارات الرسالة' }
        });
        menuButton.addEventListener('click', event => this.openContextMenu(event, message, channel));
        wrapper.append(stack, menuButton);

        if (channel === 'instagram') {
            bubble.addEventListener('dblclick', () => this.toggleQuickReaction(stack, '♥'));
        }
        return wrapper;
    },

    createInternalNote: function(message) {
        const dom = window.Dashboard.utils;
        const note = dom.createElement('aside', {
            className: 'channel-internal-note',
            attributes: { 'aria-label': 'ملاحظة داخلية لا تظهر للعميل' }
        });
        if (message.id) note.dataset.messageId = String(message.id);
        const text = dom.createElement('p', { text: message.text });
        const actions = dom.createElement('div', { className: 'internal-note-actions' });
        const edit = dom.createElement('button', {
            text: 'تعديل',
            attributes: { type: 'button', 'aria-label': 'تعديل الملاحظة الداخلية' }
        });
        const remove = dom.createElement('button', {
            className: 'is-danger', text: 'حذف',
            attributes: { type: 'button', 'aria-label': 'حذف الملاحظة الداخلية' }
        });
        edit.addEventListener('click', () => this.openInternalNoteEditor(note, message));
        remove.addEventListener('click', () => this.confirmDeleteInternalNote(message));
        actions.append(edit, remove);
        note.append(
            dom.createElement('strong', { text: 'ملاحظة داخلية' }),
            text,
            dom.createElement('time', { text: message.time || '' }),
            actions
        );
        return note;
    },

    openInternalNoteEditor: function(noteElement, message) {
        if (!message.id || noteElement.querySelector('.internal-note-editor')) return;
        const dom = window.Dashboard.utils;
        const original = noteElement.querySelector('p');
        const actions = noteElement.querySelector('.internal-note-actions');
        const editor = dom.createElement('div', { className: 'internal-note-editor' });
        const textarea = dom.createElement('textarea', {
            attributes: {
                rows: '3', maxlength: '5000',
                'aria-label': 'محتوى الملاحظة الداخلية'
            }
        });
        textarea.value = String(message.text || '');
        const controls = dom.createElement('div', { className: 'internal-note-editor-actions' });
        const save = dom.createElement('button', { text: 'حفظ', attributes: { type: 'button' } });
        const cancel = dom.createElement('button', { text: 'إلغاء', attributes: { type: 'button' } });
        const close = () => {
            editor.remove();
            original?.classList.remove('hidden');
            actions?.classList.remove('hidden');
        };
        cancel.addEventListener('click', close);
        save.addEventListener('click', async () => {
            const content = textarea.value.trim();
            if (!content) {
                window.Dashboard.feedback.notify('محتوى الملاحظة فارغ.', 'error');
                textarea.focus();
                return;
            }
            save.disabled = true;
            cancel.disabled = true;
            try {
                const response = await window.Dashboard.api.request(`/api/messages/${encodeURIComponent(message.id)}/note`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content })
                });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.error || 'تعذر تعديل الملاحظة');
                this.applyInternalNoteUpdate(message.id, content);
                window.Dashboard.feedback.notify('تم تعديل الملاحظة.');
            } catch (error) {
                save.disabled = false;
                cancel.disabled = false;
                window.Dashboard.feedback.notify(error.message || 'تعذر تعديل الملاحظة.', 'error');
            }
        });
        controls.append(save, cancel);
        editor.append(textarea, controls);
        original?.classList.add('hidden');
        actions?.classList.add('hidden');
        noteElement.appendChild(editor);
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    },

    confirmDeleteInternalNote: async function(message) {
        if (!message.id) return;
        const confirmed = await window.Dashboard.feedback.confirm({
            title: 'حذف الملاحظة الداخلية؟',
            description: 'سيتم حذف هذه الملاحظة نهائياً، ولن تظهر للمشرفين بعد ذلك.',
            confirmLabel: 'حذف الملاحظة',
            cancelLabel: 'إلغاء',
            destructive: true
        });
        if (!confirmed) return;
        try {
            const response = await window.Dashboard.api.request(`/api/messages/${encodeURIComponent(message.id)}/note`, {
                method: 'DELETE'
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'تعذر حذف الملاحظة');
            this.applyInternalNoteDelete(message.id);
            window.Dashboard.feedback.notify('تم حذف الملاحظة.');
        } catch (error) {
            window.Dashboard.feedback.notify(error.message || 'تعذر حذف الملاحظة.', 'error');
        }
    },

    applyInternalNoteUpdate: function(messageId, content) {
        const message = this.currentMessages.find(item => String(item.id) === String(messageId));
        if (message) message.text = content;
        this.lastRenderFingerprint = '';
        const user = window.Dashboard.state.usersCache.find(
            item => String(item.id) === String(window.Dashboard.state.selectedUserId)
        );
        this.renderMessageList(this.currentMessages, user?.platform || 'messenger');
    },

    applyInternalNoteDelete: function(messageId) {
        this.currentMessages = this.currentMessages.filter(item => String(item.id) !== String(messageId));
        this.lastRenderFingerprint = '';
        const user = window.Dashboard.state.usersCache.find(
            item => String(item.id) === String(window.Dashboard.state.selectedUserId)
        );
        this.renderMessageList(this.currentMessages, user?.platform || 'messenger');
    },

    createMessageContent: function(message, channel) {
        const metadata = message.metadata || {};
        if (metadata.poll && channel === 'telegram') return this.createPoll(metadata.poll);
        if (metadata.location && channel === 'telegram') return this.createLocation(metadata.location);
        if (metadata.sharedPost && channel === 'instagram') return this.createSocialPreview('منشور مشترك', metadata.sharedPost);
        if (metadata.reel && channel === 'instagram') return this.createSocialPreview('Reel', metadata.reel);
        if (metadata.storyReply && channel === 'instagram') return this.createSocialPreview('رد على قصة', metadata.storyReply);
        if (metadata.profileCard && channel === 'instagram') return this.createSocialPreview('ملف شخصي', metadata.profileCard);

        const text = String(message.text || '');
        const lower = text.toLowerCase();
        const resolvedUrl = window.Dashboard.utils.resolveUrl(text);
        if ((message.type === 'sticker' || metadata.sticker) && this.isSafeMediaUrl(resolvedUrl)) {
            return this.createImage(resolvedUrl, 'Sticker', 'message-sticker');
        }
        if ((message.type === 'gif' || /\.gif(?:$|\?)/i.test(lower)) && this.isSafeMediaUrl(resolvedUrl)) {
            return this.createImage(resolvedUrl, 'GIF', 'message-gif');
        }
        if ((message.type === 'image' || window.Dashboard.utils.isImage(lower)) && this.isSafeMediaUrl(resolvedUrl)) {
            return this.createImage(resolvedUrl, 'Image', 'message-image');
        }
        if ((message.type === 'video' || window.Dashboard.utils.isVideo(lower)) && this.isSafeMediaUrl(resolvedUrl)) {
            const video = document.createElement('video');
            video.className = 'message-video';
            video.controls = true;
            video.preload = 'metadata';
            window.Dashboard.utils.setAuthenticatedMediaSource(video, resolvedUrl);
            return video;
        }
        if ((message.type === 'audio' || message.type === 'voice' || window.Dashboard.utils.isAudio(lower)) && this.isSafeMediaUrl(resolvedUrl)) {
            const voice = window.Dashboard.utils.createElement('div', { className: 'message-voice' });
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.preload = 'metadata';
            window.Dashboard.utils.setAuthenticatedMediaSource(audio, resolvedUrl);
            voice.append(window.Dashboard.utils.createElement('span', { className: 'voice-icon', text: '◉' }), audio);
            return voice;
        }
        if ((message.type === 'document' || window.Dashboard.utils.isDocument(lower)) && this.isSafeMediaUrl(resolvedUrl)) {
            return this.createFileCard(resolvedUrl, metadata.fileName || text.split('/').pop());
        }
        return window.Dashboard.utils.createElement('p', { className: 'message-text', text });
    },

    createImage: function(url, alt, className) {
        const dom = window.Dashboard.utils;
        const frame = dom.createElement('figure', { className: 'message-media-frame is-loading' });
        const image = window.Dashboard.utils.createElement('img', {
            className,
            attributes: { alt, loading: 'lazy', decoding: 'async' }
        });
        const status = dom.createElement('span', {
            className: 'message-media-status',
            text: 'جاري تحميل الصورة…',
            attributes: { role: 'status' }
        });
        const retry = dom.createElement('button', {
            className: 'message-media-retry hidden',
            text: 'إعادة المحاولة',
            attributes: { type: 'button' }
        });
        const load = () => {
            frame.classList.remove('is-loading', 'has-error');
            status.classList.add('hidden');
            retry.classList.add('hidden');
            if (frame.dataset.stickToBottom === 'true') {
                requestAnimationFrame(() => {
                    const chatBox = document.getElementById('chat-box');
                    if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
                    delete frame.dataset.stickToBottom;
                });
            }
        };
        const fail = () => {
            frame.classList.remove('is-loading');
            frame.classList.add('has-error');
            status.textContent = 'تعذر تحميل الصورة';
            status.classList.remove('hidden');
            retry.classList.remove('hidden');
        };
        image.addEventListener('load', load);
        image.addEventListener('error', fail);
        retry.addEventListener('click', () => {
            frame.classList.add('is-loading');
            frame.classList.remove('has-error');
            status.textContent = 'جاري تحميل الصورة…';
            retry.classList.add('hidden');
            window.Dashboard.utils.setAuthenticatedMediaSource(image, url);
        });
        frame.append(image, status, retry);
        window.Dashboard.utils.setAuthenticatedMediaSource(image, url);
        return frame;
    },

    createFileCard: function(url, name) {
        const dom = window.Dashboard.utils;
        const card = dom.createElement('a', {
            className: 'message-file-card',
            attributes: { href: url, target: '_blank', rel: 'noopener noreferrer' }
        });
        card.append(
            dom.createElement('span', { className: 'file-card-icon', text: '▤' }),
            dom.createElement('span', { className: 'file-card-name', text: name || 'Document' }),
            dom.createElement('span', { className: 'file-card-action', text: 'تنزيل' })
        );
        return card;
    },

    createReplyPreview: function(reply) {
        const preview = window.Dashboard.utils.createElement('div', { className: 'message-reply-preview' });
        preview.append(
            window.Dashboard.utils.createElement('strong', { text: reply.sender || 'Reply' }),
            window.Dashboard.utils.createElement('span', { text: reply.text || reply.caption || '' })
        );
        return preview;
    },

    createReactionBar: function(reactions) {
        const bar = window.Dashboard.utils.createElement('div', { className: 'message-reactions' });
        reactions.forEach(reaction => {
            const value = typeof reaction === 'string' ? reaction : `${reaction.emoji || ''}${reaction.count > 1 ? ` ${reaction.count}` : ''}`;
            bar.appendChild(window.Dashboard.utils.createElement('span', { text: value }));
        });
        return bar;
    },

    createMessageStatus: function(status, channel) {
        const normalized = String(status || 'sent').toLowerCase();
        const labels = {
            pending: 'قيد الإرسال', sending: 'قيد الإرسال', sent: 'مرسلة',
            delivered: 'مسلّمة', read: 'مقروءة', seen: 'مقروءة', failed: 'فشل الإرسال'
        };
        let symbol = '✓';
        if (normalized === 'delivered') symbol = '✓✓';
        if (normalized === 'read' || normalized === 'seen') symbol = '✓✓';
        if (normalized === 'failed') symbol = '!';
        if (normalized === 'sending' || normalized === 'pending') symbol = '◷';
        const element = window.Dashboard.utils.createElement('span', {
            className: `message-status status-${normalized} status-${channel}`,
            attributes: { title: labels[normalized] || normalized, 'aria-label': labels[normalized] || normalized }
        });
        element.append(
            window.Dashboard.utils.createElement('span', { className: 'message-status-symbol', text: symbol }),
            window.Dashboard.utils.createElement('span', { className: 'message-status-label', text: labels[normalized] || normalized })
        );
        return element;
    },

    applyDeliveryStatus: function(messageId, status, channel) {
        const message = document.querySelector(`[data-message-id="${CSS.escape(String(messageId))}"]`);
        if (!message) return;
        const current = message.querySelector('.message-status');
        if (current) current.replaceWith(this.createMessageStatus(status, channel || window.Dashboard.state.selectedChannel));
    },

    createTypingIndicator: function(channel) {
        const row = window.Dashboard.utils.createElement('div', { className: `channel-typing typing-${channel}` });
        row.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
        return row;
    },

    createDateSeparator: function(label) {
        return window.Dashboard.utils.createElement('div', { className: 'message-date-separator', text: label });
    },

    createUnreadDivider: function() {
        return window.Dashboard.utils.createElement('div', { className: 'message-unread-divider', text: 'رسائل غير مقروءة' });
    },

    messageDateLabel: function(message) {
        if (!message.createdAt) return '';
        const date = new Date(String(message.createdAt).replace(' ', 'T') + (String(message.createdAt).includes('Z') ? '' : 'Z'));
        if (Number.isNaN(date.getTime())) return '';
        const today = new Date();
        if (date.toDateString() === today.toDateString()) return 'اليوم';
        return date.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
    },

    createPoll: function(poll) {
        const dom = window.Dashboard.utils;
        const card = dom.createElement('section', { className: 'telegram-poll' });
        card.appendChild(dom.createElement('strong', { text: poll.question || 'Poll' }));
        (poll.options || []).forEach(option => {
            card.appendChild(dom.createElement('div', {
                className: 'telegram-poll-option',
                text: typeof option === 'string' ? option : `${option.text || ''} · ${option.percent || 0}%`
            }));
        });
        return card;
    },

    createLocation: function(location) {
        return this.createSocialPreview('الموقع', {
            title: location.name || 'Shared location',
            subtitle: [location.latitude, location.longitude].filter(value => value !== undefined).join(', ')
        });
    },

    createSocialPreview: function(label, data) {
        const dom = window.Dashboard.utils;
        const card = dom.createElement('section', { className: 'message-social-preview' });
        card.append(
            dom.createElement('span', { className: 'social-preview-label', text: label }),
            dom.createElement('strong', { text: data.title || data.username || '' }),
            dom.createElement('p', { text: data.subtitle || data.caption || data.text || '' })
        );
        return card;
    },

    openContextMenu: function(event, message, channel) {
        event.stopPropagation();
        document.querySelectorAll('.message-context-menu').forEach(menu => menu.remove());
        const dom = window.Dashboard.utils;
        const menu = dom.createElement('div', { className: 'message-context-menu' });
        const copy = dom.createElement('button', { text: 'نسخ', attributes: { type: 'button' } });
        copy.addEventListener('click', () => {
            navigator.clipboard.writeText(String(message.text || '')).catch(() => {});
            menu.remove();
        });
        menu.appendChild(copy);
        document.body.appendChild(menu);
        const rect = event.currentTarget.getBoundingClientRect();
        menu.style.left = `${Math.max(8, rect.left - 110)}px`;
        menu.style.top = `${rect.bottom + 4}px`;
        setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
    },

    toggleQuickReaction: function(stack, emoji) {
        let bar = stack.querySelector('.message-reactions');
        if (!bar) {
            bar = this.createReactionBar([emoji]);
            stack.appendChild(bar);
        } else {
            bar.remove();
        }
    },

    toggleSearch: function() {
        const search = document.getElementById('conversation-search');
        if (!search) return;
        search.classList.toggle('hidden');
        if (!search.classList.contains('hidden')) search.focus();
    },

    filterCurrentConversation: function(query) {
        const normalized = String(query || '').toLowerCase();
        const user = window.Dashboard.state.usersCache.find(
            item => String(item.id) === String(window.Dashboard.state.selectedUserId)
        );
        const filtered = normalized
            ? this.currentMessages.filter(message => String(message.text || '').toLowerCase().includes(normalized))
            : this.currentMessages;
        this.renderMessageList(filtered, user ? user.platform : 'messenger');
    },

    showConversationOnMobile: function() {
        const section = document.getElementById('chat-section');
        if (!section || !window.matchMedia('(max-width: 767px)').matches) return;
        const list = document.getElementById('users-list');
        this.mobileListScrollTop = list ? list.scrollTop : 0;
        section.classList.add('mobile-conversation-open');
        document.getElementById('conversation-mobile-back')?.focus({ preventScroll: true });
    },

    closeConversationOnMobile: function() {
        const section = document.getElementById('chat-section');
        if (!section) return;
        section.classList.remove('mobile-conversation-open');
        document.querySelector('.channel-header-controls')?.classList.remove('is-mobile-actions-open');
        document.getElementById('mobile-chat-actions-toggle')?.setAttribute('aria-expanded', 'false');
        requestAnimationFrame(() => {
            const list = document.getElementById('users-list');
            if (list) list.scrollTop = this.mobileListScrollTop;
            document.querySelector(`[data-customer-id="${CSS.escape(String(window.Dashboard.state.selectedUserId || ''))}"]`)?.focus({ preventScroll: true });
        });
    },

    isSafeMediaUrl: function(value) {
        try {
            const url = new URL(value, window.location.origin);
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch (_) {
            return false;
        }
    }
};

window.selectUser = window.Dashboard.chat.selectUser;
window.assignChat = window.Dashboard.chat.assignChat;
window.fetchChatHistory = window.Dashboard.chat.fetchChatHistory;
