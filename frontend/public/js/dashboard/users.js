// Dashboard Customer and Conversation List Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.users = {
    searchQuery: '',

    init: function() {
        document.querySelectorAll('[data-chat-filter]').forEach(button => {
            button.addEventListener('click', () => this.setChatFilter(button.dataset.chatFilter));
        });
        const unreadToggle = document.getElementById('unread-only-toggle');
        if (unreadToggle) unreadToggle.addEventListener('change', () => this.toggleUnreadFilter());
        const searchInput = document.getElementById('chat-customer-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this.searchQuery = searchInput.value.trim().toLowerCase();
                this.renderUsersList();
            });
        }
        const exportButton = document.getElementById('export-customers-btn');
        if (exportButton) exportButton.addEventListener('click', () => this.exportCustomersCsv());
    },

    getFilteredUsers: function() {
        let users = [...window.Dashboard.state.usersCache];
        if (window.Dashboard.state.currentChatFilter === 'management') {
            users = users.filter(user => user.managementRequested);
        } else if (window.Dashboard.state.currentChatFilter !== 'all') {
            users = users.filter(user => user.platform === window.Dashboard.state.currentChatFilter);
        }
        if (window.Dashboard.state.showUnreadOnly) {
            users = users.filter(user => Number(user.unreadCount) > 0);
        }
        if (this.searchQuery) {
            users = users.filter(user =>
                [user.name, user.id, user.username, user.phoneNumber]
                    .some(value => String(value || '').toLowerCase().includes(this.searchQuery))
            );
        }
        return users;
    },

    exportCustomersCsv: function() {
        const users = this.getFilteredUsers();
        if (!users.length) {
            window.Dashboard.settings.showToast('لا توجد بيانات زبائن مطابقة للتصدير.', 'error');
            return;
        }
        const protectSpreadsheetValue = value => {
            const text = String(value ?? '');
            return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
        };
        const quote = value => `"${protectSpreadsheetValue(value).replace(/"/g, '""')}"`;
        const rows = [
            ['الاسم', 'رقم الهاتف', 'اسم المستخدم', 'معرف القناة', 'القناة', 'المسؤول', 'الرد الآلي', 'آخر تواصل'],
            ...users.map(user => [
                user.name, user.phoneNumber, user.username, user.id, user.platform,
                user.assignee, user.isAIEnabled ? 'مفعّل' : 'متوقف', user.lastSeen
            ])
        ];
        const csv = `\uFEFF${rows.map(row => row.map(quote).join(',')).join('\r\n')}`;
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `customers_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        window.Dashboard.settings.showToast(`تم تنزيل بيانات ${users.length} زبون.`);
    },

    setChatFilter: function(filter) {
        window.Dashboard.state.currentChatFilter = filter;
        ['all', 'telegram', 'whatsapp', 'messenger', 'instagram', 'management'].forEach(plat => {
            const btn = document.getElementById(`filter-${plat}`);
            if (btn) {
                if (plat === 'management' && plat === filter) {
                    btn.className = "w-full flex items-center justify-between py-2.5 px-3 rounded-lg bg-violet-600 text-white border border-violet-600 shadow-sm transition font-bold text-[12px]";
                } else if (plat === 'management') {
                    btn.className = "w-full flex items-center justify-between py-2.5 px-3 rounded-lg bg-white hover:bg-violet-100 text-violet-700 border border-violet-200 transition font-bold text-[12px]";
                } else if (plat === filter) {
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

        const managementCount = window.Dashboard.state.usersCache.filter(
            user => user.managementRequested
        ).length;
        const managementCountBadge = document.getElementById('management-messages-count');
        if (managementCountBadge) managementCountBadge.textContent = managementCount;

        const filteredUsers = this.getFilteredUsers();

        const platformColors = {
            telegram: 'bg-blue-400',
            whatsapp: 'bg-green-400',
            messenger: 'bg-indigo-500',
            instagram: 'bg-pink-500'
        };

        const dom = window.Dashboard.utils;
        const rows = filteredUsers.map(user => {
            const row = dom.createElement('div', {
                className: `chat-customer-row p-4 hover:bg-slate-50 cursor-pointer transition flex justify-between items-center ${String(window.Dashboard.state.selectedUserId) === String(user.id) ? 'is-selected bg-blue-50/50 border-r-2 border-blue-600' : ''}`
            });
            row.addEventListener('click', () => window.Dashboard.chat.selectUser(user.id));

            const initials = String(user.name || user.platform || '?').trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('');
            const avatar = dom.createCustomerAvatar(
                user,
                `chat-customer-avatar is-${user.platform}`,
                initials || '?'
            );
            const details = dom.createElement('div', { className: 'flex-1 min-w-0 ml-2' });
            const titleRow = dom.createElement('div', { className: 'flex items-center gap-2' });
            titleRow.append(
                dom.createElement('span', { className: `w-1.5 h-1.5 rounded-full ${platformColors[user.platform] || 'bg-slate-400'}` }),
                dom.createElement('h4', { className: 'font-semibold text-xs text-slate-900 truncate', text: user.name })
            );
            const metadata = dom.createElement('div', { className: 'flex items-center gap-2 mt-1.5' });
            metadata.appendChild(dom.createElement('span', {
                className: 'text-[12px] text-slate-400 font-inter uppercase tracking-widest',
                text: user.platform
            }));
            // AI assignment is the default and does not need a visual badge in the
            // compact conversation list. Keep only exceptional manual assignments.
            if (!user.isAIEnabled) {
                metadata.appendChild(dom.createElement('span', {
                    className: 'bg-slate-100 text-slate-700 text-[12px] font-bold px-1.5 py-0.5 rounded',
                    text: user.assignee === 'admin' ? 'الإدارة' : 'يدوي'
                }));
            }
            if (user.managementRequested) {
                metadata.appendChild(dom.createElement('span', {
                    className: 'bg-violet-100 text-violet-700 text-[12px] font-bold px-1.5 py-0.5 rounded',
                    text: '🔔 طلب إدارة'
                }));
            }
            details.append(titleRow, metadata);

            const activity = dom.createElement('div', { className: 'chat-customer-activity flex flex-col items-end gap-1 shrink-0 font-inter' });
            const rawLastSeen = String(user.lastSeen || '').trim();
            const timestampMatch = rawLastSeen.match(/^(\d{2}):(\d{2})(?::\d{2})?\s+(\d{4})-(\d{2})-(\d{2})$/);
            const activityTime = dom.createElement('time', {
                className: 'chat-customer-timestamp text-[12px] text-slate-400',
                attributes: { dir: 'ltr' }
            });
            if (timestampMatch) {
                activityTime.dateTime = `${timestampMatch[3]}-${timestampMatch[4]}-${timestampMatch[5]}T${timestampMatch[1]}:${timestampMatch[2]}`;
                activityTime.append(
                    dom.createElement('span', { className: 'chat-customer-date', text: `${timestampMatch[5]}/${timestampMatch[4]}/${timestampMatch[3]}` }),
                    dom.createElement('span', { className: 'chat-customer-time', text: `${timestampMatch[1]}:${timestampMatch[2]}` })
                );
            } else {
                activityTime.textContent = rawLastSeen || '—';
            }
            activity.appendChild(activityTime);
            if (Number(user.unreadCount) > 0) {
                activity.appendChild(dom.createElement('span', {
                    className: 'bg-blue-600 text-white text-[12px] font-bold px-1.5 py-0.5 rounded-full',
                    text: user.unreadCount
                }));
            }
            row.append(avatar, details, activity);
            return row;
        });

        if (rows.length === 0) {
            rows.push(dom.createElement('p', {
                className: 'text-slate-400 text-center p-6 text-xs font-inter',
                text: window.Dashboard.state.currentChatFilter === 'management'
                    ? 'لا توجد رسائل بانتظار الإدارة حالياً'
                    : 'لا توجد محادثات مطابقة'
            }));
        }
        listContainer.replaceChildren(...rows);

        const activeStat = document.getElementById('chat-stat-active');
        const unreadStat = document.getElementById('chat-stat-unread');
        if (activeStat) activeStat.textContent = window.Dashboard.state.usersCache.length;
        if (unreadStat) {
            unreadStat.textContent = window.Dashboard.state.usersCache.reduce(
                (sum, user) => sum + Number(user.unreadCount || 0), 0
            );
        }
    }
};

// Bind to global namespace for inline compatibility
window.setChatFilter = window.Dashboard.users.setChatFilter;
window.toggleUnreadFilter = window.Dashboard.users.toggleUnreadFilter;
window.renderUsersList = window.Dashboard.users.renderUsersList;
