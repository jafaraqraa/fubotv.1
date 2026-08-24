// Dashboard Socket.IO Real-Time Client Module (Task 13 & 14)
window.Dashboard = window.Dashboard || {};

window.Dashboard.realtime = {
    socket: null,
    processedEvents: new Set(), // Bounded event de-duplication cache (Task 9)

    init: function() {
        if (window.Dashboard.realtime.socket) return;

        console.log('🔌 Connecting to Socket.IO real-time channel...');

        const socketUrl = window.ENV ? window.ENV.SOCKET_URL : '';

        const sessionId = localStorage.getItem('futh_session_id');
        const queryParams = {};
        if (sessionId) {
            queryParams.sessionId = sessionId;
        }

        // Initialize connection with cross-origin cookie credentials enabled (Section 11)
        const socket = io(socketUrl, {
            transports: ['websocket', 'polling'],
            autoConnect: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000,
            withCredentials: true,
            query: queryParams
        });

        window.Dashboard.realtime.socket = socket;

        // Bounded event Id de-duplication check
        socket.onAny((eventName, envelope) => {
            if (envelope && envelope.eventId) {
                if (window.Dashboard.realtime.isDuplicate(envelope.eventId)) {
                    console.log(`⚠️ Ignored duplicate real-time event received: ${envelope.eventId}`);
                    return;
                }
            }
        });

        // 1. Connection established
        socket.on('connect', () => {
            console.log('✅ Real-time Socket.IO channel connected successfully!');
            window.Dashboard.realtime.onSocketConnected();
        });

        // 2. Reconnection completed (Task 16)
        socket.on('reconnect', (attempt) => {
            console.log(`🔄 Real-time Socket.IO channel reconnected! (Attempts: ${attempt})`);
            window.Dashboard.realtime.reconcileStaleState();
        });

        // 3. Connection failed / disconnected (Task 17)
        socket.on('disconnect', (reason) => {
            console.warn(`⚠️ Socket.IO disconnected. Reason: ${reason}`);
            window.Dashboard.realtime.onSocketDisconnected();
        });

        // 4. Authorization / Authentication failure (Task 19)
        socket.on('connect_error', (err) => {
            console.error('⚠️ Socket.IO connection error:', err.message);
            if (err.message === 'unauthorized') {
                window.location.href = '/login'; // Redirect to login immediately on session expiration
            }
        });

        socket.on('auth:revoked', () => {
            localStorage.removeItem('futh_session_id');
            window.location.replace('/login');
        });

        // Register central message, configuration, and errors subscription events
        window.Dashboard.realtime.registerSubscribers(socket);
    },

    isDuplicate: function(eventId) {
        if (window.Dashboard.realtime.processedEvents.has(eventId)) {
            return true;
        }
        window.Dashboard.realtime.processedEvents.add(eventId);

        // Keep cache bounded to prevent memory leaks (Task 9)
        if (window.Dashboard.realtime.processedEvents.size > 100) {
            const iterator = window.Dashboard.realtime.processedEvents.values();
            const first = iterator.next().value;
            window.Dashboard.realtime.processedEvents.delete(first);
        }
        return false;
    },

    registerSubscribers: function(socket) {
        // A. Incoming / Outgoing / Notes Message Event
        socket.on('message:created', (envelope) => {
            const msg = envelope.data;
            if (!msg) return;

            // If the message belongs to the currently focused thread (Task 12)
            if (String(window.Dashboard.state.selectedUserId) === String(msg.userId)) {
                window.Dashboard.chat.fetchChatHistory(); // Refetch active conversation to preserve sorting and media
            }

            // Re-render sidebar active connections list and unread numbers
            window.Dashboard.analytics.fetchStatsAndUsers();

            // Quietly refresh AI Usage metrics in the background immediately
            if (window.Dashboard.aiUsage && typeof window.Dashboard.aiUsage.refreshAll === 'function') {
                window.Dashboard.aiUsage.refreshAll(false);
            }
        });

        // B. Unread Count Updated Event
        socket.on('unread:updated', (envelope) => {
            const data = envelope.data;
            if (data) {
                const user = window.Dashboard.state.usersCache.find(u => String(u.id) === String(data.userId));
                if (user) {
                    user.unreadCount = data.unreadCount;
                    window.Dashboard.users.renderUsersList();
                }
            }
        });

        // C. Customer Registration / Updates
        socket.on('customer:created', (envelope) => {
            window.Dashboard.analytics.fetchStatsAndUsers();
        });
        socket.on('customer:updated', (envelope) => {
            window.Dashboard.analytics.fetchStatsAndUsers();
        });

        // D. AI State Updates
        socket.on('conversation:ai-updated', (envelope) => {
            const data = envelope.data;
            if (data && String(window.Dashboard.state.selectedUserId) === String(data.userId)) {
                window.Dashboard.chat.selectUser(data.userId);
            }
            window.Dashboard.analytics.fetchStatsAndUsers();
        });

        // E. Manual Assignment Updates
        socket.on('conversation:assignment-updated', (envelope) => {
            const data = envelope.data;
            if (data && String(window.Dashboard.state.selectedUserId) === String(data.userId)) {
                window.Dashboard.chat.selectUser(data.userId);
            }
            window.Dashboard.analytics.fetchStatsAndUsers();
        });

        // F. Global Statistics Telemetry Updates
        socket.on('stats:updated', (envelope) => {
            const stats = envelope.data;
            if (!stats) return;

            const elUsers = document.getElementById('stat-users');
            const elMsgs = document.getElementById('stat-messages');
            const elStatus = document.getElementById('stat-status');

            if (elUsers) elUsers.innerText = stats.usersCount;
            if (elMsgs) elMsgs.innerText = stats.messagesCount;

            const elAnUsers = document.getElementById('analytics-stat-users');
            const elAnMsgs = document.getElementById('analytics-stat-messages');

            if (elAnUsers) elAnUsers.innerText = stats.usersCount;
            if (elAnMsgs) elAnMsgs.innerText = stats.messagesCount;
        });

        // G. Activity Logs Updated Event
        socket.on('activity-log:created', (envelope) => {
            const log = envelope.data;
            const logsBox = document.getElementById('live-logs-box');
            if (log && logsBox) {
                const row = window.Dashboard.utils.createElement('div', {
                    className: 'border-b border-slate-800 pb-1 font-inter uppercase flex'
                });
                row.append(
                    window.Dashboard.utils.createElement('span', {
                        className: 'text-cyan-600 opacity-50',
                        text: `[${log.time}]`
                    }),
                    window.Dashboard.utils.createElement('span', {
                        className: 'text-cyan-400 mr-2 break-all text-[9px]',
                        text: log.action
                    })
                );
                logsBox.prepend(row);
            }
        });

        // H. Application Errors Logging Event
        socket.on('application-error:created', (envelope) => {
            const err = envelope.data;
            if (err) {
                // Instantly update active errors count sidebar badges
                window.Dashboard.analytics.fetchStatsAndUsers();
                if (!document.getElementById('errors-section').classList.contains('hidden')) {
                    window.Dashboard.errors.fetchErrors();
                }
            }
        });

        socket.on('application-error:updated', (envelope) => {
            const err = envelope.data;
            if (err) {
                window.Dashboard.analytics.fetchStatsAndUsers();
                if (!document.getElementById('errors-section').classList.contains('hidden')) {
                    window.Dashboard.errors.fetchErrors();
                }
            }
        });

        // I. WhatsApp Gateway Status Updates
        socket.on('whatsapp:status-updated', (envelope) => {
            const data = envelope.data;
            if (data) {
                window.Dashboard.whatsapp.renderWhatsAppStatusDirect(data);
            }
        });

        // J. RAG Document Events
        socket.on('rag:document-uploaded', (envelope) => {
            if (window.Dashboard.state.activeDrawerForm === 'rag-settings' && window.Dashboard.settings.loadDocumentsList) {
                window.Dashboard.settings.loadDocumentsList();
                window.Dashboard.settings.refreshRagStatus();
            }
        });
        socket.on('rag:document-status-updated', (envelope) => {
            if (window.Dashboard.state.activeDrawerForm === 'rag-settings' && window.Dashboard.settings.loadDocumentsList) {
                window.Dashboard.settings.loadDocumentsList();
                window.Dashboard.settings.refreshRagStatus();
            }
        });
        socket.on('rag:document-indexed', (envelope) => {
            if (window.Dashboard.state.activeDrawerForm === 'rag-settings' && window.Dashboard.settings.loadDocumentsList) {
                window.Dashboard.settings.loadDocumentsList();
                window.Dashboard.settings.refreshRagStatus();
            }
        });
        socket.on('rag:document-failed', (envelope) => {
            if (window.Dashboard.state.activeDrawerForm === 'rag-settings' && window.Dashboard.settings.loadDocumentsList) {
                window.Dashboard.settings.loadDocumentsList();
                window.Dashboard.settings.refreshRagStatus();
            }
        });
        socket.on('rag:document-deleted', (envelope) => {
            if (window.Dashboard.state.activeDrawerForm === 'rag-settings' && window.Dashboard.settings.loadDocumentsList) {
                window.Dashboard.settings.loadDocumentsList();
                window.Dashboard.settings.refreshRagStatus();
            }
        });

        // K. AI Usage Real-time Events
        socket.on('ai_usage_updated', (envelope) => {
            console.log('📊 Real-time AI Usage update received via WebSocket:', envelope);

            // Re-render sidebar active connections list and unread numbers
            if (window.Dashboard.analytics && typeof window.Dashboard.analytics.fetchStatsAndUsers === 'function') {
                window.Dashboard.analytics.fetchStatsAndUsers();
            }

            // Always trigger silent refresh of AI Usage metrics in the background immediately
            if (window.Dashboard.aiUsage && typeof window.Dashboard.aiUsage.refreshAll === 'function') {
                console.log('🔄 Triggering quiet refresh of AI Usage dashboard analytics...');
                window.Dashboard.aiUsage.refreshAll(false); // false is silent background refresh without toasts
            }
        });

        // L. Provider Budget Updated Event
        socket.on('provider_budget_updated', (envelope) => {
            console.log('📊 Real-time Provider Budget update received via WebSocket:', envelope);
            const data = envelope.data;
            if (data && data.provider) {
                const prov = data.provider.toLowerCase();
                const elVal = document.getElementById(`budget-${prov}-val`);
                const elUsed = document.getElementById(`budget-${prov}-used`);
                const elRem = document.getElementById(`budget-${prov}-remaining`);
                const elPct = document.getElementById(`budget-${prov}-pct`);
                const elBar = document.getElementById(`budget-${prov}-progress`);

                if (elVal) elVal.innerText = `$${Number(data.budget || 0).toFixed(2)}`;
                if (elUsed) elUsed.innerText = `$${Number(data.used || 0).toFixed(4)}`;
                if (elRem) elRem.innerText = `$${Number(data.remaining || 0).toFixed(4)}`;
                if (elPct) elPct.innerText = `${data.percentage}%`;
                if (elBar) elBar.style.width = `${data.percentage}%`;

                // If input in Settings is visible and not active, sync it
                const inputEl = document.getElementById(`budget-${prov}-input`);
                if (inputEl && document.activeElement !== inputEl) {
                    inputEl.value = data.budget;
                }
            }
        });
    },

    onSocketConnected: function() {
        // Pauses high-frequency 3-second fallback intervals on primary Socket active connections (Task 17)
        window.Dashboard.main.clearPollingIntervals();

        // Establish low-frequency reconciliation timer every 45 seconds as background safety fallback (Task 17)
        window.Dashboard.state.reconciliationInterval = setInterval(() => {
            console.log('🔄 Performing low-frequency database reconciliation...');
            window.Dashboard.realtime.reconcileStaleState();
        }, 45000);
    },

    onSocketDisconnected: function() {
        // Switch back to fallback mode, stopping reconciliation and activating fallback 3s interval polling (Task 17)
        if (window.Dashboard.state.reconciliationInterval) {
            clearInterval(window.Dashboard.state.reconciliationInterval);
            window.Dashboard.state.reconciliationInterval = null;
        }
        window.Dashboard.main.startPollingIntervals();
    },

    reconcileStaleState: function() {
        console.log('🔄 Reconciling staleness with backend REST endpoints...');
        // Debounced or direct reconciliation dispatches to update stats, chats, and whatsapp status (Task 16)
        window.Dashboard.analytics.fetchStatsAndUsers();
        if (window.Dashboard.state.selectedUserId) {
            window.Dashboard.chat.fetchChatHistory();
        }
        if (!document.getElementById('errors-section').classList.contains('hidden')) {
            window.Dashboard.errors.fetchErrors();
        }
        if (!document.getElementById('whatsapp-section').classList.contains('hidden')) {
            window.Dashboard.whatsapp.fetchWhatsAppStatus();
        }
    }
};
