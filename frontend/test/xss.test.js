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
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    appendChild(child) {
        this.children.push(child);
        return child;
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

test('high-risk customer, message, error, and realtime renderers contain no HTML sinks', () => {
    const files = ['users.js', 'chatThemes.js', 'chat.js', 'composer.js', 'errors.js', 'realtime.js', 'analyticsDashboard.js', 'aimodels.js', 'whatsapp.js'];
    for (const filename of files) {
        const source = fs.readFileSync(
            path.join(__dirname, '..', 'public', 'js', 'dashboard', filename),
            'utf8'
        );
        assert.doesNotMatch(source, /\.(?:innerHTML|outerHTML)\b|insertAdjacentHTML\s*\(|document\.write\s*\(/, filename);
        assert.doesNotMatch(source, /\bon(?:click|mouseover|error|load)\s*=/i, filename);
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
