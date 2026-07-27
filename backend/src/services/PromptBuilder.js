class PromptBuilder {
    /**
     * Builds the final messages payload for the AI chat completions endpoint.
     * Every channel (Telegram, WhatsApp, Playground, REST API, Facebook, Instagram)
     * uses this exact prompt builder logic.
     *
     * @param {Object} params
     * @param {string} params.systemPrompt - The base system instructions (personality, rules, safety).
     * @param {Array<Object>} params.conversationHistory - Pure, unmodified history array.
     * @param {string} params.knowledgeContext - Retrieved RAG context text.
     * @param {string} params.userQuestion - Current user's query.
     * @returns {Array<Object>} Final messages array.
     */
    static buildMessages({ systemPrompt, conversationHistory, knowledgeContext, userQuestion }) {
        const messages = [];

        // 1. System Prompt (appears ONLY once, focused on personality, rules, and safety)
        messages.push({
            role: "system",
            content: systemPrompt || ""
        });

        // 2. Conversation History (unmodified clean clone to avoid side effects or injections)
        const cleanHistory = (conversationHistory || []).map(msg => ({
            role: msg.role,
            content: msg.content
        }));
        messages.push(...cleanHistory);

        // 3. Current User Message (Knowledge Context + Instructions + User Question)
        let currentUserMessageContent = "";

        // Add Knowledge Context
        currentUserMessageContent += `Knowledge Context\n`;
        if (knowledgeContext && knowledgeContext.trim()) {
            currentUserMessageContent += `${knowledgeContext.trim()}\n\n`;
        } else {
            currentUserMessageContent += `[No knowledge context available]\n\n`;
        }

        // Add separator and Instructions
        currentUserMessageContent += `--------------------\n\n`;
        currentUserMessageContent += `Instructions\n\n`;
        currentUserMessageContent += `Answer ONLY using the knowledge context.\n\n`;
        currentUserMessageContent += `If information is unavailable,\nexplicitly state that.\n\n`;
        currentUserMessageContent += `Never invent information.\n\n`;
        currentUserMessageContent += `If multiple questions exist,\nanswer every one separately.\n\n`;

        // Add separator and User Question
        currentUserMessageContent += `--------------------\n\n`;
        currentUserMessageContent += `User Question\n\n${(userQuestion || "").trim()}`;

        messages.push({
            role: "user",
            content: currentUserMessageContent
        });

        return messages;
    }
}

module.exports = PromptBuilder;
