const ProviderAdapter = require('./ProviderAdapter');

class AnthropicAdapter extends ProviderAdapter {
    getCapabilities() {
        return {
            supportsBalance: false,
            supportsUsage: false,
            supportsQuota: false,
            supportsResetDate: false,
            supportsRateLimits: false
        };
    }

    async fetchUsageInfo() {
        const mockResult = this.parseMockKey('anthropic');
        if (mockResult) return mockResult;

        return {
            success: true,
            limitsAvailable: false,
            capabilities: this.getCapabilities(),
            balance: null,
            limit: null,
            usage: null,
            remaining: null,
            billingPeriod: null,
            resetDate: null,
            source: {},
            rawResponse: null,
            errorMessage: 'Automatic limits are unavailable for Anthropic.'
        };
    }
}

module.exports = AnthropicAdapter;
