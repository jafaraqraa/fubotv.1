'use strict';

function resolveTaskProvider(task, dependencies = {}) {
    const resolver = dependencies.getAIProviderForTask || require('../../services/aiProviders').getAIProviderForTask;
    const provider = resolver(task);
    if (!provider) { const error = new Error(`provider task is disabled or unavailable: ${task}`); error.code = 'RAG_V2_PROVIDER_UNAVAILABLE'; throw error; }
    return provider;
}

function providerDescriptor(provider, operation) {
    const name = provider.constructor?.name?.replace(/Provider$/, '').toLowerCase() || 'unknown';
    return { provider: name, model: provider.model || null, endpointType: provider.baseUrl?.startsWith('http') ? 'http' : 'native-default', operation };
}

module.exports = { resolveTaskProvider, providerDescriptor };
