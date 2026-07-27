const ProviderAdapter = require('./ProviderAdapter');

class OpenRouterAdapter extends ProviderAdapter {
    getCapabilities() {
        return {
            supportsBalance: true,
            supportsUsage: true,
            supportsQuota: true,
            supportsResetDate: true,
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

        const targetUrl = this.baseUrl || 'https://openrouter.ai/api/v1/key';
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
            if (!payload || !payload.data) {
                throw new Error('Invalid response format from OpenRouter key API.');
            }

            const keyData = payload.data;

            // Specific key metadata only
            const limit = keyData.limit !== undefined ? keyData.limit : null;
            const remaining = keyData.limit_remaining !== undefined ? keyData.limit_remaining : null;
            const usage = keyData.usage !== undefined ? keyData.usage : 0.0;
            const resetDate = keyData.limit_reset || null;

            return {
                success: true,
                limitsAvailable: true,
                capabilities: this.getCapabilities(),
                balance: remaining, // Use key-specific remaining credits
                limit: limit,
                usage: usage,
                remaining: remaining,
                billingPeriod: resetDate ? `Reset: ${resetDate}` : 'No Reset',
                resetDate: resetDate,
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
