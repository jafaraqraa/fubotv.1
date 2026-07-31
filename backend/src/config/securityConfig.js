const MIN_SECRET_LENGTH = 32;

function isProduction() {
    return process.env.NODE_ENV === 'production';
}

function requireSessionSecret() {
    const secret = process.env.SESSION_SECRET;
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
        const error = new Error(
            `SESSION_SECRET must be configured with at least ${MIN_SECRET_LENGTH} characters.`
        );
        error.code = 'INVALID_SESSION_SECRET';
        throw error;
    }
    return secret;
}

function validateProductionSecurityConfig() {
    requireSessionSecret();

    if (isProduction()) {
        const qdrantApiKey = process.env.QDRANT_API_KEY;
        if (typeof qdrantApiKey !== 'string' || qdrantApiKey.length < MIN_SECRET_LENGTH) {
            const error = new Error(
                `QDRANT_API_KEY must be configured with at least ${MIN_SECRET_LENGTH} characters in production.`
            );
            error.code = 'INSECURE_QDRANT_CONFIGURATION';
            throw error;
        }
        const metricsToken = process.env.METRICS_TOKEN;
        if (typeof metricsToken !== 'string' || metricsToken.length < MIN_SECRET_LENGTH) {
            const error = new Error(
                `METRICS_TOKEN must be configured with at least ${MIN_SECRET_LENGTH} characters in production.`
            );
            error.code = 'INSECURE_METRICS_CONFIGURATION';
            throw error;
        }
        if (process.env.DEBUG === 'true' || process.env.NODE_OPTIONS?.includes('--inspect')) {
            const error = new Error('Debug and inspector modes are forbidden in production.');
            error.code = 'INSECURE_DEBUG_CONFIGURATION';
            throw error;
        }
        if (process.env.ALLOW_SESSION_TOKEN_FALLBACK === 'true') {
            const error = new Error(
                'ALLOW_SESSION_TOKEN_FALLBACK must not be enabled in production.'
            );
            error.code = 'INSECURE_SESSION_TOKEN_FALLBACK';
            throw error;
        }
    }
    return true;
}

module.exports = {
    MIN_SECRET_LENGTH,
    isProduction,
    requireSessionSecret,
    validateProductionSecurityConfig
};
