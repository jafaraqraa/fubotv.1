// Central API Client Module (Task 4)
window.Dashboard = window.Dashboard || {};

window.Dashboard.api = {
    csrfToken: null,

    // Fetches the session-bound CSRF token from the server
    fetchCsrfToken: async function() {
        try {
            const baseUrl = window.ENV ? window.ENV.API_BASE_URL : '/api/v1';
            const headers = {};
            const sessionId = localStorage.getItem('futh_session_id');
            if (sessionId) {
                headers['X-Session-ID'] = sessionId;
            }
            const response = await fetch(`${baseUrl}/auth/csrf-token`, { 
                credentials: 'include',
                headers: headers
            });
            if (response.status === 401) {
                return null;
            }
            const data = await response.json();
            if (data.success) {
                this.csrfToken = data.csrfToken;
                return data.csrfToken;
            }
        } catch (err) {
            console.error('⚠️ Failed to retrieve CSRF token:', err.message);
        }
        return null;
    },

    // Intercepts and executes all fetch calls to centralize same-origin requests and handle 401 Unauthorized redirects
    request: async function(url, options = {}) {
        const baseUrl = window.ENV ? window.ENV.API_BASE_URL : '/api/v1';

        let targetUrl = url;
        if (url.startsWith('/api/')) {
            // Map legacy /api paths to the versioned API baseUrl
            targetUrl = `${baseUrl}${url.substring(4)}`;
        } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
            targetUrl = `${baseUrl}${url}`;
        }

        const method = (options.method || 'GET').toUpperCase();
        const isStateChanging = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

        // Always include session cookies for cross-origin credentials
        options.credentials = 'include';
        options.headers = options.headers || {};
        
        // Retrieve and attach custom X-Session-ID bypass header if present in localStorage
        const sessionId = localStorage.getItem('futh_session_id');
        if (sessionId) {
            options.headers['X-Session-ID'] = sessionId;
        }

        // Fetch and attach X-CSRF-Token header automatically for state-changing operations (Task 4)
        if (isStateChanging) {
            if (!this.csrfToken) {
                await this.fetchCsrfToken();
            }
            if (this.csrfToken) {
                options.headers['X-CSRF-Token'] = this.csrfToken;
            }
        }

        const response = await fetch(targetUrl, options);
        if (response.status === 401) {
            window.location.href = '/login';
            throw new Error('Unauthorized session. Redirecting to login.');
        }
        return response;
    }
};
