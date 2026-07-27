// Rebuilt Clean-Architecture Analytics Centralized Data Store
window.Dashboard = window.Dashboard || {};

window.Dashboard.analyticsStore = (function() {
    // Single source of truth state container
    const state = {
        overview: null,
        providers: {},
        models: [],
        history: [],
        live: [],
        openRouterBalance: null,
        lastUpdated: null,
        listeners: []
    };

    function getState() {
        // Return structured clone or deep copy to ensure no side effects
        const copy = JSON.parse(JSON.stringify(state));
        if (copy.lastUpdated) {
            copy.lastUpdated = new Date(copy.lastUpdated);
        }
        return copy;
    }

    function setOverview(overview) {
        state.overview = overview;
        state.lastUpdated = new Date();
        notify();
    }

    function setProviders(providers) {
        state.providers = providers;
        state.lastUpdated = new Date();
        notify();
    }

    function setModels(models) {
        state.models = models;
        state.lastUpdated = new Date();
        notify();
    }

    function setHistory(history) {
        state.history = history;
        state.lastUpdated = new Date();
        notify();
    }

    function setLive(live) {
        state.live = live;
        state.lastUpdated = new Date();
        notify();
    }

    function setOpenRouterBalance(balance) {
        state.openRouterBalance = balance;
        state.lastUpdated = new Date();
        notify();
    }

    /**
     * Registers a callback listener to trigger on state updates.
     */
    function subscribe(callback) {
        if (typeof callback === 'function') {
            state.listeners.push(callback);
        }
        // Return unsubscribe function
        return function unsubscribe() {
            state.listeners = state.listeners.filter(l => l !== callback);
        };
    }

    function notify() {
        const currentState = getState();
        state.listeners.forEach(callback => {
            try {
                callback(currentState);
            } catch (err) {
                console.error('[AnalyticsStore] Listener notification error:', err);
            }
        });
    }

    return {
        getState,
        setOverview,
        setProviders,
        setModels,
        setHistory,
        setLive,
        setOpenRouterBalance,
        subscribe
    };
})();
