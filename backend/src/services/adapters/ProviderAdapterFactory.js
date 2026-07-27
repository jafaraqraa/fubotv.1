const OpenRouterAdapter = require('./OpenRouterAdapter');
const OpenAIAdapter = require('./OpenAIAdapter');
const AnthropicAdapter = require('./AnthropicAdapter');
const GeminiAdapter = require('./GeminiAdapter');

class ProviderAdapterFactory {
    /**
     * Instantiates the correct concrete Adapter for a given provider and API Key.
     */
    static getAdapter(providerName, apiKey, baseUrl = '') {
        const provider = (providerName || 'openrouter').toLowerCase().trim();
        switch (provider) {
            case 'openrouter':
                return new OpenRouterAdapter(apiKey, baseUrl);
            case 'openai':
                return new OpenAIAdapter(apiKey, baseUrl);
            case 'anthropic':
                return new AnthropicAdapter(apiKey, baseUrl);
            case 'gemini':
                return new GeminiAdapter(apiKey, baseUrl);
            default:
                return null;
        }
    }
}

module.exports = ProviderAdapterFactory;
