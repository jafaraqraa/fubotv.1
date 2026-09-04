const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'css', 'dashboard.css'),
    'utf8'
);

test('desktop conversation controls wrap as grouped flex rows without overlap', () => {
    assert.match(css, /\.channel-header-controls\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s);
    assert.match(css, /\.channel-header-controls\s*\{[^}]*min-width:\s*0;/s);
    assert.match(css, /#chat-header-actions\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s);
    assert.match(css, /#chat-header-actions\s*>\s*\*\s*\{[^}]*flex:\s*0\s+0\s+auto;/s);
    assert.match(css, /#chat-assignee-select\s*\{[^}]*max-width:/s);
});
