// Dashboard AI and Conversation Assignment Controls Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.conversationControls = {
    openConfirmModal: function(userId, userName, currentAIState) {
        window.Dashboard.state.pendingToggleUserId = userId;
        const modal = document.getElementById('confirm-modal');
        const title = document.getElementById('confirm-modal-title');
        const text = document.getElementById('confirm-modal-text');
        const icon = document.getElementById('confirm-modal-icon');
        const yesBtn = document.getElementById('confirm-yes-btn');

        if (!modal || !title || !text || !icon || !yesBtn) return;

        icon.innerText = "AI";
        if (currentAIState) {
            title.innerText = "تعطيل وكيل الذكاء الاصطناعي؟";
            text.innerText = `تغيير حالة الرد الآلي للعميل ${userName} إلى الرد اليدوي بالكامل.`;
            yesBtn.className = "w-full bg-red-500 hover:bg-red-600 text-white font-bold text-[10px] py-3 px-8 rounded-lg transition uppercase tracking-widest shadow-lg";
            yesBtn.innerText = "PAUSE AI";
        } else {
            title.innerText = "تفعيل وكيل الذكاء الاصطناعي؟";
            text.innerText = `تفعيل الرد التلقائي بالذكاء الاصطناعي للعميل ${userName} بناء على سياق قاعدة المعرفة.`;
            yesBtn.className = "w-full bg-slate-900 hover:bg-black text-white font-bold text-[10px] py-3 px-8 rounded-lg transition uppercase tracking-widest shadow-lg";
            yesBtn.innerText = "ACTIVATE AI";
        }

        yesBtn.onclick = window.Dashboard.conversationControls.executeToggleAI;

        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            const subDiv = modal.querySelector('div');
            if (subDiv) subDiv.classList.remove('scale-95');
        }, 10);
    },

    openSettingsConfirmModal: function(type, payload, titleText, descText, iconLabel, btnColorClass) {
        window.Dashboard.state.pendingSettingsPayload = payload;
        window.Dashboard.state.pendingSettingsType = type;

        const modal = document.getElementById('confirm-modal');
        const title = document.getElementById('confirm-modal-title');
        const text = document.getElementById('confirm-modal-text');
        const icon = document.getElementById('confirm-modal-icon');
        const yesBtn = document.getElementById('confirm-yes-btn');

        if (!modal || !title || !text || !icon || !yesBtn) return;

        icon.innerText = iconLabel;
        title.innerText = titleText;
        text.innerText = descText;
        yesBtn.className = `${btnColorClass} text-white font-bold text-[10px] py-3 px-8 rounded-lg transition uppercase tracking-widest shadow-lg`;
        yesBtn.innerText = "CONFIRM SYNC";
        yesBtn.onclick = window.Dashboard.settings.executeSaveSettings;

        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            const subDiv = modal.querySelector('div');
            if (subDiv) subDiv.classList.remove('scale-95');
        }, 10);
    },

    closeConfirmModal: function() {
        const modal = document.getElementById('confirm-modal');
        if (!modal) return;
        modal.classList.add('opacity-0');
        const subDiv = modal.querySelector('div');
        if (subDiv) subDiv.classList.add('scale-95');
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 300);
        window.Dashboard.state.pendingToggleUserId = null;
        window.Dashboard.state.pendingSettingsPayload = null;
        window.Dashboard.state.pendingSettingsType = "";
    },

    executeToggleAI: async function() {
        const pendingToggleUserId = window.Dashboard.state.pendingToggleUserId;
        if (!pendingToggleUserId) return;

        try {
            const pendingUser = window.Dashboard.state.usersCache.find(
                user => String(user.id) === String(pendingToggleUserId)
            );
            const response = await window.Dashboard.api.request('/api/chat/toggle-ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: pendingToggleUserId,
                    tenantId: pendingUser ? pendingUser.tenantId : undefined
                })
            });
            const result = await response.json();

            if (result.success) {
                window.Dashboard.conversationControls.closeConfirmModal();
                const user = window.Dashboard.state.usersCache.find(u => String(u.id) === String(window.Dashboard.state.selectedUserId));
                if (user) {
                    user.isAIEnabled = result.isAIEnabled;
                    window.Dashboard.chat.selectUser(window.Dashboard.state.selectedUserId);
                }
                window.Dashboard.analytics.fetchStatsAndUsers();
            } else {
                alert('خطأ: ' + result.error);
            }
        } catch (err) {
            alert('فشل الاتصال بالسيرفر لتغيير حالة الذكاء.');
        }
    }
};

// Bind to global namespace for inline compatibility
window.openConfirmModal = window.Dashboard.conversationControls.openConfirmModal;
window.openSettingsConfirmModal = window.Dashboard.conversationControls.openSettingsConfirmModal;
window.closeConfirmModal = window.Dashboard.conversationControls.closeConfirmModal;
window.executeToggleAI = window.Dashboard.conversationControls.executeToggleAI;
