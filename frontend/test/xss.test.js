const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.className = '';
        this.textContent = '';
        this.attributes = {};
        this.children = [];
        this.listeners = {};
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    addEventListener(name, handler) {
        this.listeners[name] = handler;
    }

    remove() {
        this.removed = true;
    }
}

const document = {
    createElement: tagName => new FakeElement(tagName)
};
const context = { window: {}, document };
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'dashboard', 'utils.js'), 'utf8'),
    context
);

const payloads = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '\"><svg/onload=alert(1)>'
];

test('untrusted values are created as text nodes, never HTML elements', () => {
    for (const payload of payloads) {
        const element = context.window.Dashboard.utils.createElement('span', { text: payload });
        assert.equal(element.textContent, payload);
        assert.equal(element.children.length, 0);
        assert.equal(element.attributes.onerror, undefined);
        assert.equal(element.attributes.onload, undefined);
    }
});

test('customer avatars accept only authenticated local profile image paths', () => {
    const utils = context.window.Dashboard.utils;
    const safe = utils.createCustomerAvatar(
        { name: 'Safe', avatarUrl: '/uploads/profile_0123456789abcdef01234567.jpg' },
        'avatar',
        'SA'
    );
    assert.equal(safe.children.length, 1);
    assert.equal(safe.children[0].tagName, 'IMG');
    assert.equal(safe.children[0].attributes.src, '/uploads/profile_0123456789abcdef01234567.jpg');
    assert.equal(safe.children[0].attributes.referrerpolicy, 'no-referrer');

    for (const avatarUrl of [
        'https://evil.example/avatar.jpg',
        '/uploads/not-a-profile.jpg',
        '\"><img src=x onerror=alert(1)>'
    ]) {
        const unsafe = utils.createCustomerAvatar({ name: 'Unsafe', avatarUrl }, 'avatar', 'UN');
        assert.equal(unsafe.children.length, 0);
        assert.equal(unsafe.textContent, 'UN');
    }
});

test('high-risk customer, message, error, and realtime renderers contain no HTML sinks', () => {
    const dashboardDirectory = path.join(__dirname, '..', 'public', 'js', 'dashboard');
    const files = fs.readdirSync(dashboardDirectory).filter(filename => filename.endsWith('.js'));
    for (const filename of files) {
        const source = fs.readFileSync(
            path.join(dashboardDirectory, filename),
            'utf8'
        );
        if (filename !== 'utils.js') {
            assert.doesNotMatch(
                source,
                /\.(?:innerHTML|outerHTML)\b|insertAdjacentHTML\s*\(|document\.write\s*\(/,
                filename
            );
        } else {
            assert.match(source, /DOMPurify\.sanitize/, 'The only reviewed HTML sink must use DOMPurify');
            assert.equal((source.match(/\.innerHTML\s*=/g) || []).length, 1);
        }
        assert.doesNotMatch(
            source,
            /\son(?:click|change|input|load|error|mouseover)\s*=\s*["']/i,
            filename
        );
    }

    const dashboardHtml = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'dashboard.html'),
        'utf8'
    );
    assert.doesNotMatch(dashboardHtml, /\son(?:click|change|input|load|error|mouseover)\s*=/i);
    assert.match(dashboardHtml, /\/vendor\/dompurify\.min\.js/);
    assert.match(dashboardHtml, /\/js\/dashboard\/eventBindings\.js/);
});

test('XSS payloads are escaped when approved rich fragments require interpolation', () => {
    for (const payload of payloads) {
        const escaped = context.window.Dashboard.utils.escapeHTML(payload);
        assert.equal(escaped.includes('<'), false);
        assert.equal(escaped.includes('>'), false);
        assert.equal(escaped.includes('<script'), false);
        assert.equal(escaped.includes('<img'), false);
        assert.equal(escaped.includes('<svg'), false);
    }
});

test('all four channel themes exist and theme switching replaces previous state', () => {
    const shell = new FakeElement('div');
    shell.dataset = {};
    shell.style = { setProperty(name, value) { this[name] = value; } };
    const input = new FakeElement('input');
    input.placeholder = '';
    const themeDocument = {
        getElementById(id) {
            if (id === 'conversation-shell') return shell;
            if (id === 'direct-msg-input') return input;
            return null;
        }
    };
    const themeContext = {
        window: { Dashboard: { state: { currentMessageType: 'reply' } } },
        document: themeDocument
    };
    vm.createContext(themeContext);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'dashboard', 'chatThemes.js'), 'utf8'),
        themeContext
    );
    const provider = themeContext.window.Dashboard.chatThemes;
    assert.deepEqual(Object.keys(provider.themes), ['whatsapp', 'telegram', 'messenger', 'instagram']);
    provider.apply('whatsapp');
    assert.equal(shell.dataset.channel, 'whatsapp');
    provider.apply('instagram');
    assert.equal(shell.dataset.channel, 'instagram');
    assert.equal(input.placeholder, 'مراسلة...');
});
