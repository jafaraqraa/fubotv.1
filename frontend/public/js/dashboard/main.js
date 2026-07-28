// Dashboard Main Bootstrapping Entry Module (Tasks 14, 17, 18)
window.Dashboard = window.Dashboard || {};

window.Dashboard.main = {
    init: function() {
        console.log("🎨 Initializing FUThing Dashboard Frontend Workspace...");

        // 1. Initial state pull via authoritative REST endpoints (Task 15)
        window.Dashboard.analytics.fetchStatsAndUsers();
        if (window.Dashboard.users && window.Dashboard.users.init) window.Dashboard.users.init();
        if (window.Dashboard.chat && window.Dashboard.chat.init) window.Dashboard.chat.init();
        if (window.Dashboard.composer && window.Dashboard.composer.init) window.Dashboard.composer.init();
        const assignee = document.getElementById('chat-assignee-select');
        if (assignee) {
            assignee.addEventListener('change', () => {
                window.Dashboard.chat.assignChat(window.Dashboard.state.selectedUserId, assignee.value);
            });
        }
        const search = document.getElementById('conversation-search');
        if (search) search.addEventListener('input', () => window.Dashboard.chat.filterCurrentConversation(search.value));
        const mobileBack = document.getElementById('conversation-mobile-back');
        if (mobileBack) mobileBack.addEventListener('click', () => window.Dashboard.chat.closeConversationOnMobile());

        // Initialize redesigned API keys limits dashboard and management list
        if (window.Dashboard.apiKeys && typeof window.Dashboard.apiKeys.init === 'function') {
            window.Dashboard.apiKeys.init();
        }

        // Initialize empty registry for tracking active interval IDs
        window.Dashboard.state.pollingIntervals = {
            stats: null,
            chat: null,
            whatsapp: null
        };

        // 2. Try starting the real-time Socket.IO connection (Task 13)
        window.Dashboard.realtime.init();

        // 3. Fallback polling start if socket disconnects or isn't connected yet
        if (!window.Dashboard.realtime.socket || !window.Dashboard.realtime.socket.connected) {
            window.Dashboard.main.startPollingIntervals();
        }

        // 4. Register browser tab visibility state transitions (Task 18)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                console.log('👁️ Tab visible again. Running single debounced reconciliation...');
                if (window.Dashboard.realtime.socket && window.Dashboard.realtime.socket.connected) {
                    window.Dashboard.realtime.reconcileStaleState();
                } else {
                    window.Dashboard.main.startPollingIntervals();
                }
            } else {
                console.log('👁️ Tab hidden. Stopping background polling activity.');
                window.Dashboard.main.clearPollingIntervals();
            }
        });

        console.log("🚀 Dashboard initialized successfully!");
    },

    startPollingIntervals: function() {
        // Guard against duplicate polling timers (Task 20)
        window.Dashboard.main.clearPollingIntervals();

        // Avoid starting timers if the tab is currently hidden
        if (document.visibilityState === 'hidden') return;

        console.log('⏱️ Fallback interval polling started.');

        // Stats/users polling interval: 3 seconds (Task 17)
        window.Dashboard.state.pollingIntervals.stats = setInterval(window.Dashboard.analytics.fetchStatsAndUsers, 3000);

        // Chat transcripts polling interval: 3 seconds (Task 17)
        window.Dashboard.state.pollingIntervals.chat = setInterval(window.Dashboard.chat.fetchChatHistory, 3000);

        // WhatsApp status polling interval: 5 seconds (Task 17)
        window.Dashboard.state.pollingIntervals.whatsapp = setInterval(window.Dashboard.whatsapp.fetchWhatsAppStatus, 5000);
    },

    clearPollingIntervals: function() {
        if (!window.Dashboard.state.pollingIntervals) return;

        if (window.Dashboard.state.pollingIntervals.stats) {
            clearInterval(window.Dashboard.state.pollingIntervals.stats);
            window.Dashboard.state.pollingIntervals.stats = null;
        }
        if (window.Dashboard.state.pollingIntervals.chat) {
            clearInterval(window.Dashboard.state.pollingIntervals.chat);
            window.Dashboard.state.pollingIntervals.chat = null;
        }
        if (window.Dashboard.state.pollingIntervals.whatsapp) {
            clearInterval(window.Dashboard.state.pollingIntervals.whatsapp);
            window.Dashboard.state.pollingIntervals.whatsapp = null;
        }
    }
};

// Start initialization once DOM content is fully loaded
document.addEventListener('DOMContentLoaded', function() {
    window.Dashboard.main.init();
});
