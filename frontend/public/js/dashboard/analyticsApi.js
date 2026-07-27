// Rebuilt Clean-Architecture Analytics API Client Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.analyticsApi = {
    /**
     * Helper to perform a safe request to the analytics routes.
     */
    _request: async function(endpoint, queryParams = {}) {
        const query = new URLSearchParams(queryParams).toString();
        const url = `/analytics${endpoint}${query ? '?' + query : ''}`;
        const response = await window.Dashboard.api.request(url);
        if (!response.ok) {
            throw new Error(`Analytics API error on ${endpoint}: ${response.statusText}`);
        }
        return await response.json();
    },

    fetchOverview: async function(tenantId = 'default') {
        return this._request('/overview', { tenantId });
    },

    fetchProviders: async function(tenantId = 'default') {
        return this._request('/providers', { tenantId });
    },

    fetchModels: async function(tenantId = 'default') {
        return this._request('/models', { tenantId });
    },

    fetchHistory: async function(tenantId = 'default') {
        return this._request('/history', { tenantId });
    },

    fetchLive: async function(tenantId = 'default') {
        return this._request('/live', { tenantId });
    },

    fetchOpenRouterBalance: async function(forceRefresh = false) {
        const url = forceRefresh ? '/providers/openrouter/balance/refresh' : '/providers/openrouter/balance';
        const response = await window.Dashboard.api.request(url);
        if (!response.ok) {
            throw new Error(`OpenRouter balance API error: ${response.statusText}`);
        }
        return await response.json();
    }
};
