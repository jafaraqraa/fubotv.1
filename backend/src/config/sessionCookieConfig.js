const VALID_SAME_SITE_VALUES = new Set(['strict', 'lax', 'none']);

function parseBoolean(value, name) {
    if (value === undefined || value === '') return undefined;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    const error = new Error(`${name} must be either "true" or "false".`);
    error.code = 'INVALID_SESSION_COOKIE_CONFIGURATION';
    throw error;
}

function getSessionCookieOptions(env = process.env) {
    const isProduction = env.NODE_ENV === 'production';
    const configuredSecure = parseBoolean(env.COOKIE_SECURE, 'COOKIE_SECURE');
    const secure = configuredSecure ?? isProduction;
    const sameSite = String(
        env.COOKIE_SAME_SITE || (secure ? 'none' : 'lax')
    ).trim().toLowerCase();

    if (!VALID_SAME_SITE_VALUES.has(sameSite)) {
        const error = new Error(
            'COOKIE_SAME_SITE must be one of "strict", "lax", or "none".'
        );
        error.code = 'INVALID_SESSION_COOKIE_CONFIGURATION';
        throw error;
    }
    if (sameSite === 'none' && !secure) {
        const error = new Error(
            'COOKIE_SAME_SITE=none requires COOKIE_SECURE=true.'
        );
        error.code = 'INVALID_SESSION_COOKIE_CONFIGURATION';
        throw error;
    }

    return {
        httpOnly: true,
        sameSite,
        secure,
        maxAge: 28_800_000,
        domain: env.COOKIE_DOMAIN || undefined
    };
}

function getSessionCookieClearOptions(env = process.env) {
    const { httpOnly, sameSite, secure, domain } = getSessionCookieOptions(env);
    return { httpOnly, sameSite, secure, domain };
}

module.exports = {
    getSessionCookieOptions,
    getSessionCookieClearOptions
};
