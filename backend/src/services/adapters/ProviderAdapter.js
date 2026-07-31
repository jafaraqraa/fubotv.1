const crypto = require('crypto');

class ProviderAdapter {
    constructor(apiKey, baseUrl = '') {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
    }

    /**
     * Gets adapter-specific capabilities
     */
    getCapabilities() {
        return {
            supportsBalance: false,
            supportsUsage: false,
            supportsQuota: false,
            supportsResetDate: false,
            supportsRateLimits: false
        };
    }

    /**
     * Helper to compute secure hash of the API key
     */
    static hashKey(key) {
        if (!key) return '';
        return crypto.createHash('sha256').update(key).digest('hex');
    }

    /**
     * Helper to mask API key for safe UI display
     */
    static maskKey(key) {
        if (!key) return '';
        if (key.length <= 8) return '••••••••';
        return '••••••••' + key.substring(key.length - 4);
    }

    /**
     * Checks and parses mock keys for local testing
     */
    parseMockKey(providerName) {
        const mocksEnabled = process.env.NODE_ENV === 'test'
            && process.env.ALLOW_MOCK_PROVIDER_KEYS === 'true';
        if (!mocksEnabled) return null;

        if (this.apiKey && this.apiKey.startsWith('mock-')) {
            const parts = this.apiKey.split('-');
            let limit = 100.0;
            let usage = 15.0;
            let period = 'Monthly';
            let reset = '2026-04-01';

            for (let i = 0; i < parts.length; i++) {
                if (parts[i] === 'limit' && parts[i + 1]) {
                    limit = parseFloat(parts[i + 1]);
                }
                if ((parts[i] === 'used' || parts[i] === 'usage') && parts[i + 1]) {
                    usage = parseFloat(parts[i + 1]);
                }
                if (parts[i] === 'period' && parts[i + 1]) {
                    period = parts[i + 1];
                }
                if (parts[i] === 'reset' && parts[i + 1]) {
                    reset = parts[i + 1];
                }
            }

            // Mock can expose capabilities for full UI validation
            const capabilities = {
                supportsBalance: this.apiKey.includes('supportsBalance'),
                supportsUsage: this.apiKey.includes('supportsUsage') || usage > 0,
                supportsQuota: this.apiKey.includes('supportsQuota'),
                supportsResetDate: this.apiKey.includes('supportsResetDate') || !!reset,
                supportsRateLimits: this.apiKey.includes('supportsRateLimits')
            };

            // If none are specified in string, set sensible defaults for mock testing
            if (!Object.values(capabilities).some(v => v === true)) {
                capabilities.supportsBalance = true;
                capabilities.supportsUsage = true;
                capabilities.supportsResetDate = true;
            }

            return {
                success: true,
                limitsAvailable: true,
                capabilities,
                balance: Math.max(0, limit - usage),
                limit,
                usage,
                remaining: Math.max(0, limit - usage),
                billingPeriod: period,
                resetDate: reset,
                source: {
                    balance: 'provider',
                    limit: 'provider',
                    usage: 'provider',
                    remaining: 'provider',
                    billingPeriod: 'provider',
                    resetDate: 'provider'
                },
                rawResponse: { mock: true, limit, usage },
                errorMessage: null
            };
        }
        return null;
    }

    /**
     * Fetches usage, balance, billing info from provider
     */
    async fetchUsageInfo() {
        throw new Error('fetchUsageInfo() must be implemented by concrete adapters.');
    }
}

module.exports = ProviderAdapter;
