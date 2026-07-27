// Dashboard Navigation Logic Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.navigation = {
    showSection: function(sectionId) {
        // Guard if we already are on this section
        const activeSection = [...document.querySelectorAll('main > div')].find(el => !el.classList.contains('hidden'));
        if (activeSection && activeSection.id === sectionId) return;

        // check if there are any unsaved changes
        if (window.Dashboard.navigation.hasUnsavedChanges()) {
            const leave = confirm("You have unsaved changes. Leave anyway? / لديك تعديلات غير محفوظة. هل تريد المغادرة على أي حال؟");
            if (!leave) return;
            window.Dashboard.navigation.discardUnsavedChanges();
        }

        const sections = ['chat-section', 'errors-section', 'settings-section', 'whatsapp-section', 'analytics-section', 'rag-section', 'aimodels-section', 'usage-section'];
        sections.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.add('hidden');
                el.classList.remove('flex', 'block');
            }
        });

        const titleElement = document.getElementById('page-title');

        ['btn-chat', 'btn-errors', 'btn-settings', 'btn-whatsapp', 'btn-analytics', 'btn-rag', 'btn-aimodels', 'btn-usage'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.className = "w-full text-right flex items-center gap-3 py-2.5 px-4 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition";
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
        }

        if (sectionId === 'chat-section') {
            if (activeEl) activeEl.classList.add('flex');
            if (titleElement) titleElement.innerText = "إدارة البوت والمحادثات المباشرة";
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
