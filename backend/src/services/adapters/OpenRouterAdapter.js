const ProviderAdapter = require('./ProviderAdapter');

class OpenRouterAdapter extends ProviderAdapter {
    getCapabilities() {
        return {
            supportsBalance: true,
            supportsUsage: true,
            supportsQuota: false,
            supportsResetDate: false,
            supportsRateLimits: false
        };
    }

    async fetchUsageInfo() {
        const mockResult = this.parseMockKey('openrouter');
        if (mockResult) return mockResult;

        if (!this.apiKey) {
            return {
                success: false,
                limitsAvailable: false,
                capabilities: this.getCapabilities(),
                errorMessage: 'API Key is missing for OpenRouter.'
            };
        }

        const targetUrl = this.baseUrl || 'https://openrouter.ai/api/v1/credits';
        try {
            console.log(`🌐 [OpenRouterAdapter] Requesting URL: ${targetUrl}`);
            const response = await fetch(targetUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`HTTP ${response.status}: ${text}`);
            }

            const payload = await response.json();
            if (!payload.data) {
                throw new Error('Invalid response format from OpenRouter credits API.');
            }

            const {
                total_credits = 0,
                total_usage = 0
            } = payload.data;

            const remainingBalance = Math.max(0, total_credits - total_usage);

            return {
                success: true,
                limitsAvailable: true,
                capabilities: this.getCapabilities(),
                balance: total_credits,
                limit: total_credits,
                usage: total_usage,
                remaining: remainingBalance,
                billingPeriod: 'Pay-as-you-go',
                resetDate: null,
                source: {
                    balance: 'provider',
                    limit: 'provider',
                    usage: 'provider',
                    remaining: 'provider',
                    billingPeriod: 'provider',
                    resetDate: 'provider'
                },
                rawResponse: payload,
                errorMessage: null
            };
        } catch (err) {
            console.error('❌ [OpenRouterAdapter] Error:', err.message);
            return {
                success: false,
                limitsAvailable: false,
                capabilities: this.getCapabilities(),
                errorMessage: err.message
            };
        }
    }
}

module.exports = OpenRouterAdapter;
