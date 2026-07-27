// Dashboard Chat Rendering Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.chat = {
    selectUser: async function(userId) {
        window.Dashboard.state.selectedUserId = userId;
        const user = window.Dashboard.state.usersCache.find(u => String(u.id) === String(userId));
        if (!user) return;

        const headerInfo = document.getElementById('chat-user-header-info');
        if (headerInfo) {
            headerInfo.innerHTML = `
                <div class="flex items-center gap-2">
                    <span class="text-xs font-bold text-slate-900">${user.name}</span>
                    <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest font-inter">${user.platform}</span>
                    <span class="text-[9px] font-bold px-2 py-0.5 rounded-full ${user.isAIEnabled ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}">
                        ${user.isAIEnabled ? 'AI AGENT' : 'MANUAL'}
                    </span>
                </div>
            `;
        }

        const currentIdEl = document.getElementById('current-chat-id');
        if (currentIdEl) {
            currentIdEl.innerText = `ID: ${userId}`;
        }

        const headerActions = document.getElementById('chat-header-actions');
        if (headerActions) {
            headerActions.innerHTML = `
                <button onclick="openConfirmModal('${user.id}', '${user.name}', ${user.isAIEnabled})" class="text-[10px] font-bold px-4 py-1.5 rounded-lg transition uppercase tracking-widest ${user.isAIEnabled ? 'bg-slate-100 text-slate-600 hover:bg-red-50' : 'bg-slate-900 text-white hover:bg-black'}">
                    ${user.isAIEnabled ? 'PAUSE AI AGENT' : 'ACTIVATE AI AGENT'}
                </button>
            `;
        }

        // Show/update chat assignment UI controls
        const assigneeContainer = document.getElementById('assignee-container');
        if (assigneeContainer) {
            assigneeContainer.classList.remove('hidden');
        }
        const selectEl = document.getElementById('chat-assignee-select');
        if (selectEl) {
            selectEl.value = user.isAIEnabled ? 'ai' : (user.assignee || 'ai');
        }

        const inputEl = document.getElementById('direct-msg-input');
        if (inputEl) inputEl.removeAttribute('disabled');

        const sendBtn = document.getElementById('send-btn');
        if (sendBtn) sendBtn.removeAttribute('disabled');

        const uploadBtn = document.getElementById('media-upload-btn');
        if (uploadBtn) uploadBtn.removeAttribute('disabled');

        window.Dashboard.chat.fetchChatHistory();
    },

    assignChat: async function(userId, assignee) {
        if (!userId) return;
        try {
            const response = await window.Dashboard.api.request('/api/chat/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, assignee })
            });
            const result = await response.json();
            if (result.success) {
                const user = window.Dashboard.state.usersCache.find(u => String(u.id) === String(userId));
                if (user) {
                    user.assignee = assignee;
                }
                window.Dashboard.analytics.fetchStatsAndUsers();
            }
        } catch (err) {
            console.log(`Chat assigned locally to: ${assignee}`);
        }
    },

    fetchChatHistory: async function() {
        const selectedUserId = window.Dashboard.state.selectedUserId;
        if (!selectedUserId) return;

        try {
            const response = await window.Dashboard.api.request(`/api/chat/${selectedUserId}`);
            const messages = await response.json();

            const chatBox = document.getElementById('chat-box');
            if (!chatBox) return;

            if (messages.length > 0) {
                chatBox.innerHTML = messages.map(msg => {
                    // Support secret internal notes
                    if (msg.type === 'note' || msg.isNote === true) {
                        return `
                            <div class="flex flex-col items-center my-2 w-full">
                                <div class="max-w-md w-full p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 shadow-sm relative text-right">
                                    <div class="flex items-center justify-between text-[10px] font-bold text-amber-750 uppercase tracking-wider mb-2 border-b border-amber-200/50 pb-1.5">
                                        <span>ملاحظة داخلية للموظفين فقط</span>
                                        <span>Staff View Only</span>
                                    </div>
                                    <p class="text-xs font-semibold leading-relaxed">${window.Dashboard.utils.escapeHTML(msg.text)}</p>
                                    <span class="text-[9px] text-amber-500 mt-2 block uppercase font-inter tracking-widest text-left">${msg.time} — ${msg.sender}</span>
                                </div>
                            </div>
                        `;
                    }

                    // Rich Media Handling
                    let mediaContent = `<p>${window.Dashboard.utils.escapeHTML(msg.text)}</p>`;
                    const lowerText = String(msg.text).toLowerCase();
                    const resolvedMediaUrl = window.Dashboard.utils.resolveUrl(msg.text);

                    if (window.Dashboard.utils.isImage(lowerText)) {
                        mediaContent = `
                            <div class="space-y-2 text-right">
                                <img src="${resolvedMediaUrl}" alt="Image" class="rounded-lg max-w-xs border border-slate-200 max-h-48 object-cover cursor-pointer hover:opacity-95 transition">
                                <a href="${resolvedMediaUrl}" target="_blank" class="text-[9px] text-blue-600 hover:underline block font-mono">View Full Image</a>
                            </div>
                        `;
                    } else if (window.Dashboard.utils.isVideo(lowerText)) {
                        mediaContent = `
                            <div class="space-y-2 text-right">
                                <video controls class="rounded-lg max-w-xs border border-slate-200 max-h-48">
                                    <source src="${resolvedMediaUrl}" type="video/mp4">
                                    Your browser does not support the video tag.
                                </video>
                            </div>
                        `;
                    } else if (window.Dashboard.utils.isAudio(lowerText)) {
                        mediaContent = `
                            <div class="space-y-2 text-right">
                                <span class="text-[10px] text-slate-500 font-bold block">مذكرة صوتية (Audio File)</span>
                                <audio controls class="max-w-xs outline-none">
                                    <source src="${resolvedMediaUrl}">
                                    Your browser does not support the audio element.
                                </audio>
                            </div>
                        `;
                    } else if (window.Dashboard.utils.isDocument(lowerText)) {
                        mediaContent = `
                            <div class="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3 max-w-xs text-right">
                                <svg class="w-8 h-8 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                                <div class="min-w-0 flex-1">
                                    <h4 class="text-xs font-bold text-slate-800 truncate">Document Attachment</h4>
                                    <a href="${resolvedMediaUrl}" target="_blank" class="text-[10px] text-blue-600 hover:underline font-mono">Download PDF File</a>
                                </div>
                            </div>
                        `;
                    }

                    return `
                        <div class="flex flex-col ${msg.sender === 'admin' ? 'items-end' : 'items-start'}">
                            <div class="max-w-md p-4 rounded-xl text-xs ${msg.sender === 'admin' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white text-slate-800 rounded-bl-none border border-slate-200 shadow-sm'}">
                                ${mediaContent}
                            </div>
                            <span class="text-[9px] text-slate-400 mt-1 uppercase font-inter tracking-widest">${msg.time} — ${msg.sender}</span>
                        </div>
                    `;
                }).join('');
                chatBox.scrollTop = chatBox.scrollHeight;
            } else {
                chatBox.innerHTML = '<p class="text-slate-400 text-center my-auto text-xs uppercase tracking-widest font-inter">No previous messages</p>';
            }
        } catch (err) {
            console.error(err);
        }
    }
};

// Bind to global namespace for inline compatibility
window.selectUser = window.Dashboard.chat.selectUser;
window.assignChat = window.Dashboard.chat.assignChat;
window.fetchChatHistory = window.Dashboard.chat.fetchChatHistory;
