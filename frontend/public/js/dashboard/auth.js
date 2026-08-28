// Dashboard Authentication UI Logic Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.auth = {
    logoutAdmin: async function() {
        if (!await window.Dashboard.feedback.confirm({
            title: 'تسجيل الخروج',
            description: 'ستنتهي جلسة الإدارة الحالية وستحتاج إلى تسجيل الدخول مجدداً للوصول إلى لوحة التحكم.',
            confirmLabel: 'تسجيل الخروج'
        })) return;
        try {
            const response = await window.Dashboard.api.request('/api/auth/logout', { method: 'POST' });
            if (response.ok) {
                localStorage.removeItem('futh_session_id');
                window.location.href = '/login';
            }
        } catch (e) {
            window.Dashboard.feedback.notify("حدث خطأ أثناء تسجيل الخروج.");
        }
    }
};

// Bind to global namespace for inline compatibility
window.logoutAdmin = window.Dashboard.auth.logoutAdmin;
