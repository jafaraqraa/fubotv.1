const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboardJs = path.join(__dirname, '..', 'public', 'js', 'dashboard');

test('conversation composer contains no simulated media delivery or false-success catch', () => {
    const source = fs.readFileSync(path.join(dashboardJs, 'composer.js'), 'utf8');
    assert.doesNotMatch(source, /futh-storage\.com/);
    assert.doesNotMatch(source, /simulation dispatched successfully/i);
    assert.match(source, /readAsDataURL/);
    assert.match(source, /mediaData/);
    assert.match(source, /result\.success/);
});

test('RAG controls contain no random simulated progress or unconditional operation success', () => {
    const source = fs.readFileSync(path.join(dashboardJs, 'rag.js'), 'utf8');
    assert.doesNotMatch(source, /simulateIndexingProgress/);
    assert.doesNotMatch(source, /Math\.random\(\)\s*\*\s*12/);
    assert.doesNotMatch(source, /تم تنفيذ الإجراء.*بنجاح/);
    assert.match(source, /reconciliation\/run/);
    assert.match(source, /هذه العملية غير منفذة في الخادم حالياً/);
    assert.match(source, /runBulkRequests/);
    assert.match(source, /\['indexed', 'active'\]\.includes/,
        'RAG indexing actions must accept the backend active terminal state');
    assert.doesNotMatch(source, /'فشل إعادة الفهرسة: ' \+ data\.error/,
        'Document reindex failures must never render an undefined server error');
});

test('loading WhatsApp configuration never restarts an unchanged provider', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'dashboard', 'whatsapp.js'),
        'utf8'
    );
    assert.match(source, /toggleWhatsAppProviderUI\(false\)/);
    assert.match(source, /toggleWhatsAppProviderUI:\s*async function\(persistSelection = true\)/);
});

test('customer export uses filtered tenant-scoped API data and protects CSV formulas', () => {
    const source = fs.readFileSync(path.join(dashboardJs, 'users.js'), 'utf8');
    assert.match(source, /exportCustomersCsv/);
    assert.match(source, /getFilteredUsers/);
    assert.match(source, /\^\[=\+\\-@\\t\\r\]/);
    assert.match(source, /phoneNumber/);
});

test('conversation timestamps keep date and time readable in RTL layouts', () => {
    const source = fs.readFileSync(path.join(dashboardJs, 'users.js'), 'utf8');
    assert.match(source, /chat-customer-timestamp/);
    assert.match(source, /attributes: \{ dir: 'ltr' \}/);
    assert.match(source, /chat-customer-date/);
    assert.match(source, /chat-customer-time/);
});

test('management inbox filters notified conversations without relying on assignment and displays a live count', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
    const source = fs.readFileSync(path.join(dashboardJs, 'users.js'), 'utf8');
    assert.match(html, /id="filter-management"/);
    assert.match(html, /id="management-messages-count"/);
    assert.match(source, /currentChatFilter === 'management'/);
    assert.match(source, /user\.managementRequested/);
    assert.match(source, /لا توجد رسائل بانتظار الإدارة حالياً/);
    const chatSource = fs.readFileSync(path.join(dashboardJs, 'chat.js'), 'utf8');
    assert.match(chatSource, /managementEscalation/);
    assert.match(chatSource, /scrollIntoView/);
    assert.match(chatSource, /تمت المعالجة — إبقاء AI/);
    assert.match(chatSource, /resolveManagementRequest/);
});

test('protected message media URLs resolve through the backend API origin', () => {
    const source = fs.readFileSync(path.join(dashboardJs, 'utils.js'), 'utf8');
    assert.match(source, /url\.startsWith\('\/api\/'\)/);
    assert.match(source, /window\.Dashboard\.api\.resolveUrl\(url\)/);
    assert.match(source, /setAuthenticatedMediaSource/);
    assert.match(source, /window\.Dashboard\.api\.request\(url\)/);
    assert.match(source, /URL\.createObjectURL/);
    assert.match(source, /localStorage\.getItem\('futh_session_id'\)/);
});

test('chat media has a same-origin authenticated proxy fallback', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(serverSource, /\/api\/media\/:attachmentId\/download/);
    assert.match(serverSource, /cookie: req\.headers\.cookie/);
    const utilsSource = fs.readFileSync(path.join(dashboardJs, 'utils.js'), 'utf8');
    assert.match(utilsSource, /url\.startsWith\('\/api\/media\/'\)/);
});
