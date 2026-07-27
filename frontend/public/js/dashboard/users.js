// Dashboard Customer and Conversation List Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.users = {
    setChatFilter: function(filter) {
        window.Dashboard.state.currentChatFilter = filter;
        ['all', 'telegram', 'whatsapp', 'messenger', 'instagram'].forEach(plat => {
            const btn = document.getElementById(`filter-${plat}`);
            if (btn) {
                if (plat === filter) {
                    btn.className = "flex-1 py-1.5 px-2 text-center rounded bg-blue-600 text-white shadow-sm transition";
                } else {
                    btn.className = "flex-1 py-1.5 px-2 text-center rounded bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 transition";
                }
            }
        });
        window.Dashboard.users.renderUsersList();
    },

    toggleUnreadFilter: function() {
        window.Dashboard.state.showUnreadOnly = document.getElementById('unread-only-toggle').checked;
        window.Dashboard.users.renderUsersList();
    },

    renderUsersList: function() {
        const listContainer = document.getElementById('users-list');
        if (!listContainer) return;

        let filteredUsers = window.Dashboard.state.usersCache;
        if (window.Dashboard.state.currentChatFilter !== 'all') {
            filteredUsers = window.Dashboard.state.usersCache.filter(u => u.platform === window.Dashboard.state.currentChatFilter);
        }

        if (window.Dashboard.state.showUnreadOnly) {
            filteredUsers = filteredUsers.filter(u => u.unreadCount > 0);
        }

        const platformColors = {
            telegram: 'bg-blue-400',
            whatsapp: 'bg-green-400',
            messenger: 'bg-indigo-500',
            instagram: 'bg-pink-500'
        };

        if (filteredUsers.length > 0) {
            listContainer.innerHTML = filteredUsers.map(user => `
                <div onclick="selectUser('${user.id}')" class="p-4 hover:bg-slate-50 cursor-pointer transition flex justify-between items-center ${String(window.Dashboard.state.selectedUserId) === String(user.id) ? 'bg-blue-50/50 border-r-2 border-blue-600' : ''}">
                    <div class="flex-1 min-w-0 ml-2">
                        <div class="flex items-center gap-2">
                            <span class="w-1.5 h-1.5 rounded-full ${platformColors[user.platform] || 'bg-slate-400'}"></span>
                            <h4 class="font-semibold text-xs text-slate-900 truncate">${user.name}</h4>
                        </div>
                        <div class="flex items-center gap-2 mt-1.5">
                            <span class="text-[9px] text-slate-400 font-inter uppercase tracking-widest">${user.platform}</span>
                            ${!user.isAIEnabled ? '<span class="bg-slate-100 text-slate-700 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider font-inter">Manual</span>' : ''}
                        </div>
                    </div>
                    <div class="flex flex-col items-end gap-1 shrink-0 font-inter">
                        <span class="text-[9px] text-slate-400">${user.lastSeen}</span>
                        ${user.unreadCount > 0 ? `<span class="bg-blue-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full">${user.unreadCount}</span>` : ''}
                    </div>
                </div>
            `).join('');
        } else {
            listContainer.innerHTML = '<p class="text-slate-400 text-center p-6 text-xs font-inter">No matching users</p>';
        }
    }
};

// Bind to global namespace for inline compatibility
window.setChatFilter = window.Dashboard.users.setChatFilter;
window.toggleUnreadFilter = window.Dashboard.users.toggleUnreadFilter;
window.renderUsersList = window.Dashboard.users.renderUsersList;
