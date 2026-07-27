const settingsRepository = require('../database/repositories/settingsRepository');
const providerBalanceCacheRepository = require('../database/repositories/providerBalanceCacheRepository');

class OpenRouterBalanceService {
    /**
     * Fetches balance from OpenRouter API, saves to cache, and returns the result.
     * Respects a 5-minute cache lifespan unless `force` is true.
     */
    static async getBalance(force = false) {
        const providerName = 'openrouter';
        const apiKey = process.env.OPENROUTER_API_KEY || settingsRepository.getSetting('OPENROUTER_API_KEY');

        // Check cache first
        if (!force) {
            const cached = providerBalanceCacheRepository.getBalanceCache(providerName);
            if (cached) {
                const lastUpdatedTime = new Date(cached.last_updated + ' UTC').getTime();
                const now = Date.now();
                const cacheDuration = 5 * 60 * 1000; // 5 minutes

                // Bypass cache if it has a missing-key error but we actually have an API key now
                const isCachedErrorButKeyExists = cached.error_message && 
                    cached.error_message.includes('API Key is missing') && 
                    apiKey;

                if (!isCachedErrorButKeyExists && (now - lastUpdatedTime < cacheDuration)) {
                    console.log('🔄 Returning cached OpenRouter balance data.');
                    return {
                        success: !cached.error_message,
                        currentBalance: cached.current_balance,
                        remainingBalance: cached.remaining_balance,
                        usageData: JSON.parse(cached.usage_data || '{}'),
                        errorMessage: cached.error_message,
                        lastUpdated: cached.last_updated
                    };
                }
            }
        }

        if (!apiKey) {
            const errStr = 'API Key is missing for OpenRouter.';
            providerBalanceCacheRepository.saveBalanceCache({
                provider: providerName,
                error_message: errStr
            });
            return { success: false, errorMessage: errStr, lastUpdated: new Date().toISOString() };
        }

        const targetUrl = 'https://openrouter.ai/api/v1/credits';
        try {
            console.log(`🌐 [Balance API Request] URL المستدعى إلى OpenRouter: ${targetUrl}`);
            const response = await fetch(targetUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            console.log(`🌐 [Balance API Response] Status Code من OpenRouter: ${response.status}`);

            const contentType = (response.headers && typeof response.headers.get === 'function')
                ? (response.headers.get('content-type') || '')
                : 'application/json'; // Default to application/json in test/mock environments

            let payload = null;

            if (contentType.includes('application/json')) {
                payload = await response.json();
                console.log('🌐 [Balance API Response] Body القادم من OpenRouter (JSON):', JSON.stringify(payload));
            } else {
                const rawText = await response.text();
                console.log('🌐 [Balance API Response] Body القادم من OpenRouter (Non-JSON):', rawText);
                throw new Error(`Expected JSON but received Content-Type: ${contentType}. Raw response snippet: ${rawText.slice(0, 200)}`);
            }

            if (!response.ok) {
                const errMsg = payload?.error?.message || `HTTP Error ${response.status}`;
                throw new Error(errMsg);
            }

            if (!payload.data) {
                throw new Error('Invalid response format from OpenRouter API.');
            }

            const {
                total_credits = 0,
                total_usage = 0
            } = payload.data;

            const remainingBalance = Math.max(0, total_credits - total_usage);

            const usageData = {
                totalCredits: total_credits,
                totalUsage: total_usage,
                remainingBalance: remainingBalance
            };

            const cacheData = {
                provider: providerName,
                current_balance: total_credits,
                remaining_balance: remainingBalance,
                usage_data: JSON.stringify(usageData),
                error_message: null
            };

            providerBalanceCacheRepository.saveBalanceCache(cacheData);

            return {
                success: true,
                currentBalance: total_credits,
                remainingBalance,
                usageData,
                errorMessage: null,
                lastUpdated: new Date().toISOString()
            };
        } catch (err) {
            console.error('❌ Failed to fetch OpenRouter balance:', err.message);

            // Handle expired or authentication errors explicitly
            let isAuthError = err.message.toLowerCase().includes('auth') || err.message.toLowerCase().includes('key') || err.message.toLowerCase().includes('401');
            const userFriendlyError = isAuthError
                ? 'Authentication failed: Please check your API key.'
                : `Network/API Error: ${err.message}`;

            // Save error into the cache but preserve previous numeric balances if possible
            const lastCache = providerBalanceCacheRepository.getBalanceCache(providerName);
            providerBalanceCacheRepository.saveBalanceCache({
                provider: providerName,
                current_balance: lastCache ? lastCache.current_balance : 0,
                remaining_balance: lastCache ? lastCache.remaining_balance : 0,
                usage_data: lastCache ? lastCache.usage_data : '{}',
                error_message: userFriendlyError
            });

            return {
                success: false,
                currentBalance: lastCache ? lastCache.current_balance : 0,
                remainingBalance: lastCache ? lastCache.remaining_balance : 0,
                usageData: JSON.parse((lastCache ? lastCache.usage_data : '{}') || '{}'),
                errorMessage: userFriendlyError,
                lastUpdated: lastCache ? lastCache.last_updated : new Date().toISOString()
            };
        }
    }
}

module.exports = OpenRouterBalanceService;
