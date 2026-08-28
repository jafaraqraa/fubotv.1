// Dashboard Navigation Logic Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.navigation = {
    sectionIds: ['chat-section', 'errors-section', 'settings-section', 'whatsapp-section', 'analytics-section', 'rag-section', 'aimodels-section', 'usage-section'],
    storageKey: 'futh_dashboard_active_section',

    rememberSection: function(sectionId) {
        if (!this.sectionIds.includes(sectionId)) return;
        try { localStorage.setItem(this.storageKey, sectionId); } catch (_) { /* storage is optional */ }
    },

    restoreLastSection: function() {
        let sectionId = 'chat-section';
        try { sectionId = localStorage.getItem(this.storageKey) || sectionId; } catch (_) { /* storage is optional */ }
        if (!this.sectionIds.includes(sectionId) || !document.getElementById(sectionId)) {
            sectionId = 'chat-section';
        }
        this.showSection(sectionId, { skipUnsavedCheck: true });
    },

    showSection: async function(sectionId, options = {}) {
        // Guard if we already are on this section
        const activeSection = [...document.querySelectorAll('main > div')].find(el => !el.classList.contains('hidden'));
        if (activeSection && activeSection.id === sectionId) {
            window.Dashboard.navigation.rememberSection(sectionId);
            window.Dashboard.navigation.closeMobileMenu();
            return;
        }

        // check if there are any unsaved changes
        if (!options.skipUnsavedCheck && window.Dashboard.navigation.hasUnsavedChanges()) {
            const leave = await window.Dashboard.feedback.confirm({
                title: 'تغييرات غير محفوظة',
                description: 'إذا غادرت الآن ستفقد التعديلات التي لم تحفظها في هذه الصفحة.',
                confirmLabel: 'مغادرة دون حفظ',
                destructive: true
            });
            if (!leave) return;
            window.Dashboard.navigation.discardUnsavedChanges();
        }

        const sections = window.Dashboard.navigation.sectionIds;
        sections.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.add('hidden');
                el.classList.remove('flex', 'block');
            }
        });

        const titleElement = document.getElementById('page-title');
        const subtitleElement = document.getElementById('page-subtitle');

        ['btn-chat', 'btn-errors', 'btn-settings', 'btn-whatsapp', 'btn-analytics', 'btn-rag', 'btn-aimodels', 'btn-usage'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.className = "w-full text-right flex items-center gap-3 py-2.5 px-4 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition";
                btn.removeAttribute('aria-current');
            }
        });

        const activeEl = document.getElementById(sectionId);
        if (activeEl) {
            activeEl.classList.remove('hidden');
        }

        const btnSuffix = sectionId.split('-')[0];
        const activeBtn = document.getElementById(`btn-${btnSuffix}`);
        if (activeBtn) {
            activeBtn.className = "w-full text-right flex items-center gap-3 py-2.5 px-4 rounded-lg bg-blue-600 text-white font-semibold transition shadow-md shadow-blue-600/10";
            activeBtn.setAttribute('aria-current', 'page');
        }

        if (sectionId === 'chat-section') {
            if (activeEl) activeEl.classList.add('flex');
            if (titleElement) titleElement.innerText = "إدارة الدعم والمحادثات المباشرة";
            if (subtitleElement) {
                subtitleElement.innerText = "تواصل مع عملائك عبر القنوات المفعّلة في النظام من مكان واحد";
                subtitleElement.classList.remove('hidden');
            }
        } else if (sectionId === 'errors-section') {
            if (activeEl) activeEl.classList.add('block');
            if (titleElement) titleElement.innerText = "سجل استقرار النظام";
            window.Dashboard.errors.fetchErrors();
        } else if (sectionId === 'whatsapp-section') {
            if (activeEl) activeEl.classList.add('block');
            if (titleElement) titleElement.innerText = "بوابة اتصال WhatsApp";
            window.Dashboard.whatsapp.loadWhatsAppConfig();
            window.Dashboard.whatsapp.fetchWhatsAppStatus();
        } else if (sectionId === 'analytics-section') {
            if (activeEl) activeEl.classList.add('block');
            if (titleElement) titleElement.innerText = "تحليلات الأداء والتقارير الرسومية";
            window.Dashboard.analytics.fetchStatsAndUsers();
        } else if (sectionId === 'rag-section') {
            if (activeEl) activeEl.classList.add('block');
            if (titleElement) titleElement.innerText = "نظام المعرفة وقاعدة بيانات RAG";
            // Initialize RAG module
            if (window.Dashboard.rag && window.Dashboard.rag.init) {
                window.Dashboard.rag.init();
            }
        } else if (sectionId === 'aimodels-section') {
            if (activeEl) activeEl.classList.add('block');
            if (titleElement) titleElement.innerText = "إدارة موديلات الذكاء الاصطناعي (AI Models)";
            // Initialize AI Models module
            if (window.Dashboard.aimodels && window.Dashboard.aimodels.init) {
                window.Dashboard.aimodels.init();
            }
        } else if (sectionId === 'usage-section') {
            if (activeEl) activeEl.classList.add('block');
            if (titleElement) titleElement.innerText = "استهلاك واستخدام الذكاء الاصطناعي (AI Usage & Billing)";
            // Initialize AI Usage module
            if (window.Dashboard.aiUsage && window.Dashboard.aiUsage.init) {
                window.Dashboard.aiUsage.init();
            }
        } else {
            if (activeEl) activeEl.classList.add('block');
            if (titleElement) titleElement.innerText = "الإعدادات العامة وقنوات الاتصال";
            window.Dashboard.analytics.fetchStatsAndUsers();
        }
        if (sectionId !== 'chat-section' && subtitleElement) subtitleElement.classList.add('hidden');
        if (titleElement) document.title = `${titleElement.innerText} — FuBot`;
        window.Dashboard.navigation.rememberSection(sectionId);
        window.Dashboard.navigation.closeMobileMenu();
    },

    closeMobileMenu: function() {
        const sidebar = document.getElementById('dashboard-sidebar');
        const backdrop = document.getElementById('mobile-menu-backdrop');
        const trigger = document.getElementById('mobile-menu-button');
        if (sidebar) sidebar.classList.remove('is-mobile-open');
        if (backdrop) backdrop.classList.remove('is-visible');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('mobile-menu-open');
    },

    toggleMobileMenu: function() {
        const sidebar = document.getElementById('dashboard-sidebar');
        const backdrop = document.getElementById('mobile-menu-backdrop');
        const trigger = document.getElementById('mobile-menu-button');
        if (!sidebar || !backdrop || !trigger) return;
        const willOpen = !sidebar.classList.contains('is-mobile-open');
        sidebar.classList.toggle('is-mobile-open', willOpen);
        backdrop.classList.toggle('is-visible', willOpen);
        trigger.setAttribute('aria-expanded', String(willOpen));
        document.body.classList.toggle('mobile-menu-open', willOpen);
    },

    hasUnsavedChanges: function() {
        // 1. Check if drawer has dirty changes (legacy general settings)
        if (window.Dashboard.state.drawerOpen && typeof window.Dashboard.settings.checkFormDirty === 'function') {
            if (window.Dashboard.settings.checkFormDirty()) return true;
        }
        // 2. Check if inline pages has unsaved changes
        if (window.Dashboard.state.hasUnsavedChanges === true) {
            return true;
        }
        return false;
    },

    discardUnsavedChanges: function() {
        // Force close legacy drawer
        if (window.Dashboard.state.drawerOpen && typeof window.Dashboard.settings.closeSettingsDrawer === 'function') {
            window.Dashboard.settings.closeSettingsDrawer(true);
        }
        // Discard inline RAG unsaved changes
        if (window.Dashboard.state.hasUnsavedChanges === true) {
            window.Dashboard.state.hasUnsavedChanges = false;
            if (window.Dashboard.rag && typeof window.Dashboard.rag.discardChanges === 'function') {
                window.Dashboard.rag.discardChanges();
            }
        }
    }
};

// Bind to global namespace for inline compatibility
window.showSection = window.Dashboard.navigation.showSection;

document.addEventListener('DOMContentLoaded', () => {
    const trigger = document.getElementById('mobile-menu-button');
    const backdrop = document.getElementById('mobile-menu-backdrop');
    if (trigger) trigger.addEventListener('click', window.Dashboard.navigation.toggleMobileMenu);
    if (backdrop) backdrop.addEventListener('click', window.Dashboard.navigation.closeMobileMenu);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') window.Dashboard.navigation.closeMobileMenu();
    });
    window.addEventListener('resize', () => {
        if (window.innerWidth >= 1024) window.Dashboard.navigation.closeMobileMenu();
    });
});
