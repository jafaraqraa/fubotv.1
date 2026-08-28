const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const read = relative => fs.readFileSync(path.join(publicDir, relative), 'utf8');

test('dashboard exposes navigation, announcements, and modal semantics', () => {
    const html = read('dashboard.html');
    assert.match(html, /aria-label="التنقل الرئيسي"/);
    assert.match(html, /id="btn-chat" aria-current="page"/);
    assert.match(html, /id="futh-toast-container" aria-live="polite" aria-atomic="true"/);
    assert.match(html, /id="confirm-modal" role="dialog" aria-modal="true"/);
    assert.match(html, /aria-labelledby="delete-custom-model-title"/);
});

test('keyboard focus and reduced motion preferences are supported', () => {
    const css = read('css/dashboard.css');
    assert.match(css, /:focus-visible/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test('login reports validation accessibly and uses a clear action label', () => {
    const html = read('login.html');
    assert.match(html, /id="error-alert" role="alert" aria-live="assertive"/);
    assert.match(html, /required aria-required="true"/);
    assert.match(html, /aria-invalid/);
    assert.match(html, />تسجيل الدخول</);
    assert.doesNotMatch(html, /دخول الآمن/);
});

test('errors view builds status rows safely and localizes empty states', () => {
    const source = read('js/dashboard/errors.js');
    assert.doesNotMatch(source, /innerHTML\s*=/);
    assert.match(source, /لا توجد أعطال مسجلة/);
    assert.match(source, /userFacingError/);
});

test('user-facing errors mask infrastructure details', () => {
    const source = read('js/dashboard/utils.js');
    assert.match(source, /userFacingError/);
    assert.match(source, /ECONNREFUSED/);
    assert.match(source, /تعذر الاتصال بالخادم/);
});

test('normal product flows contain no native browser dialogs', () => {
    const dashboardDir = path.join(publicDir, 'js', 'dashboard');
    const files = fs.readdirSync(dashboardDir).filter(file => file.endsWith('.js') && file !== 'feedback.js');
    for (const file of files) {
        const source = fs.readFileSync(path.join(dashboardDir, file), 'utf8');
        assert.doesNotMatch(source, /(^|[^\w.])(alert|confirm|prompt)\s*\(/m, `${file} contains a native dialog`);
    }
});

test('user-facing typography has no utility or stylesheet size below 12px', () => {
    const files = ['dashboard.html', 'login.html', 'index.html'];
    for (const file of files) assert.doesNotMatch(read(file), /text-\[(?:[1-9]|10|11)px\]/);
    assert.doesNotMatch(read('css/dashboard.css'), /font-size:\s*(?:[1-9]|10|11)px/);
    assert.doesNotMatch(read('css/settings.css'), /font-size:\s*(?:[1-9]|10|11)px/);
});
