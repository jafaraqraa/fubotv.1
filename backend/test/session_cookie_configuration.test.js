const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getSessionCookieOptions,
    getSessionCookieClearOptions
} = require('../src/config/sessionCookieConfig');

test('plain HTTP development uses a browser-compatible session cookie', () => {
    const options = getSessionCookieOptions({ NODE_ENV: 'development' });
    assert.equal(options.secure, false);
    assert.equal(options.sameSite, 'lax');
    assert.equal(options.httpOnly, true);
});

test('production defaults to a cross-origin HTTPS session cookie', () => {
    const options = getSessionCookieOptions({ NODE_ENV: 'production' });
    assert.equal(options.secure, true);
    assert.equal(options.sameSite, 'none');
});

test('explicit secure cookie settings are honored and clearCookie attributes match', () => {
    const env = {
        NODE_ENV: 'development',
        COOKIE_SECURE: 'true',
        COOKIE_SAME_SITE: 'strict',
        COOKIE_DOMAIN: 'app.example.com'
    };
    const cookie = getSessionCookieOptions(env);
    const clear = getSessionCookieClearOptions(env);
    assert.deepEqual(clear, {
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        secure: cookie.secure,
        domain: cookie.domain
    });
});

test('SameSite=None without Secure is rejected', () => {
    assert.throws(
        () => getSessionCookieOptions({
            NODE_ENV: 'development',
            COOKIE_SECURE: 'false',
            COOKIE_SAME_SITE: 'none'
        }),
        /requires COOKIE_SECURE=true/
    );
});

test('invalid cookie configuration is rejected', () => {
    assert.throws(
        () => getSessionCookieOptions({ COOKIE_SECURE: 'sometimes' }),
        /must be either/
    );
    assert.throws(
        () => getSessionCookieOptions({ COOKIE_SAME_SITE: 'wildcard' }),
        /must be one of/
    );
});
