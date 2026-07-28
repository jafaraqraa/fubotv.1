// Unified, channel-themed conversation renderer.
window.Dashboard = window.Dashboard || {};

window.Dashboard.chat = {
    currentMessages: [],
    visibleMessageLimit: 100,
    requestSequence: 0,
    lastRenderFingerprint: '',

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
            const avatar = dom.createElement('div', {
                className: 'channel-avatar',
                text: String(user.name || theme.avatar).slice(0, 2).toUpperCase()
            });
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

            if (user.platform === 'instagram' && user.capabilities && user.capabilities.calls) {
                actions.replaceChildren(
                    this.createHeaderIcon('☎', 'مكالمة'),
                    this.createHeaderIcon('▣', 'مكالمة فيديو'),
                    search,
                    this.createAutomationButton(user)
                );
            } else {
                actions.replaceChildren(search, this.createAutomationButton(user));
            }
        }
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

    configureConversationControls: function(user) {
        const assignee = document.getElementById('assignee-container');
        if (assignee) assignee.classList.remove('hidden');
        const select = document.getElementById('chat-assignee-select');
        if (select) select.value = user.isAIEnabled ? 'ai' : (user.assignee || 'ai');
        ['direct-msg-input', 'send-btn', 'media-upload-btn'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.removeAttribute('disabled');
        });
    },

    assignChat: async function(userId, assignee) {
        if (!userId) return;
        try {
            const user = window.Dashboard.state.usersCache.find(item => String(item.id) === String(userId));
            const response = await window.Dashboard.api.request('/api/chat/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, assignee, tenantId: user ? user.tenantId : undefined })
            });
            const result = await response.json();
            if (result.success && user) {
                user.assignee = assignee;
                window.Dashboard.analytics.fetchStatsAndUsers();
            }
        } catch (error) {
            console.error('Unable to assign conversation:', error);
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
            const response = await window.Dashboard.api.request(`/api/chat/${encodeURIComponent(selectedUserId)}${tenantQuery}`);
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
        const note = dom.createElement('aside', { className: 'channel-internal-note' });
        note.append(
            dom.createElement('strong', { text: 'ملاحظة داخلية · Staff only' }),
            dom.createElement('p', { text: message.text }),
            dom.createElement('time', { text: message.time || '' })
        );
        return note;
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
            video.src = resolvedUrl;
            return video;
        }
        if ((message.type === 'audio' || message.type === 'voice' || window.Dashboard.utils.isAudio(lower)) && this.isSafeMediaUrl(resolvedUrl)) {
            const voice = window.Dashboard.utils.createElement('div', { className: 'message-voice' });
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.preload = 'metadata';
            audio.src = resolvedUrl;
            voice.append(window.Dashboard.utils.createElement('span', { className: 'voice-icon', text: '◉' }), audio);
            return voice;
        }
        if ((message.type === 'document' || window.Dashboard.utils.isDocument(lower)) && this.isSafeMediaUrl(resolvedUrl)) {
            return this.createFileCard(resolvedUrl, metadata.fileName || text.split('/').pop());
        }
        return window.Dashboard.utils.createElement('p', { className: 'message-text', text });
    },

    createImage: function(url, alt, className) {
        const image = window.Dashboard.utils.createElement('img', {
            className,
            attributes: { alt, loading: 'lazy', decoding: 'async' }
        });
        image.src = url;
        return image;
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
        let symbol = '✓';
        if (normalized === 'delivered') symbol = '✓✓';
        if (normalized === 'read' || normalized === 'seen') symbol = '✓✓';
        if (normalized === 'failed') symbol = '!';
        if (normalized === 'sending' || normalized === 'pending') symbol = '◷';
        return window.Dashboard.utils.createElement('span', {
            className: `message-status status-${normalized} status-${channel}`,
            text: symbol,
            attributes: { title: normalized }
        });
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
        if (section) section.classList.add('mobile-conversation-open');
    },

    closeConversationOnMobile: function() {
        const section = document.getElementById('chat-section');
        if (section) section.classList.remove('mobile-conversation-open');
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
