const { reportError } = require('./logger');
const { reliableFetch } = require('../utils/reliableFetch');

class OpenRouterService {
    /**
     * Calls OpenRouter Chat Completions API.
     *
     * @param {Array<Object>} messages - The messages payload.
     * @param {Object} options - Model options.
     * @param {string} options.model - The model ID to use.
     * @param {string} options.apiKey - OpenRouter API Key.
     * @param {number} options.temperature - Request temperature.
     * @returns {Promise<string|null>} The raw response text or null if failed.
     */
    static async callChatCompletions(messages, { model, apiKey, temperature }) {
        try {
            console.log(`🤖 [OpenRouterService] requesting completions using model: [${model}] and temperature: [${temperature}]...`);
            const response = await reliableFetch("https://openrouter.ai/api/v1/chat/completions", {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'http://localhost:3005',
                    'X-Title': 'Telegram RAG Memory Bot'
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    temperature: temperature
                })
            });

            const data = await response.json();

            if (data.error) {
                reportError("OpenRouter AI API", data.error.message || JSON.stringify(data.error));
                return null;
            }

            if (data.choices && data.choices[0] && data.choices[0].message) {
                return data.choices[0].message.content;
            }

            return null;
        } catch (error) {
            console.error("❌ [OpenRouterService] Error connecting to OpenRouter:", error.message);
            const { addLog } = require('./logger');
            addLog("خطأ في الاتصال بالذكاء الاصطناعي");
            return null;
        }
    }
}

module.exports = OpenRouterService;
