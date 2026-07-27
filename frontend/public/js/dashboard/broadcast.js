// Dashboard Broadcast Message Dispatcher Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.broadcast = {
    sendBroadcast: async function() {
        const textarea = document.getElementById('broadcast-msg');
        if (!textarea) return;
        const message = textarea.value.trim();
        if (!message) return alert('الرجاء كتابة نص الإعلان أولاً.');

        try {
            const response = await window.Dashboard.api.request('/api/broadcast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });
            const result = await response.json();
            if (result.success) {
                alert('Broadcast Processed.');
                textarea.value = '';
                window.Dashboard.analytics.fetchStatsAndUsers();
            } else {
                alert('خطأ: ' + result.error);
            }
        } catch (err) {
            alert('حدث خطأ بالاتصال بالسيرفر.');
        }
    }
};

// Bind to global namespace for inline compatibility
window.sendBroadcast = window.Dashboard.broadcast.sendBroadcast;
