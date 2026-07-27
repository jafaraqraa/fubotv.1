// Rebuilt Clean-Architecture Analytics & AI Usage Dashboard Module
window.Dashboard = window.Dashboard || {};

window.Dashboard.analyticsDashboard = (function() {
    let autoRefreshInterval = null;
    let charts = {};

    /**
     * Bootstrapping function for the dashboard UI.
     */
    function init() {
        console.log('📊 Initializing Rebuilt Analytics & AI Usage Dashboard...');

        // Subscribe UI rendering to Store updates
        window.Dashboard.analyticsStore.subscribe(renderUI);

        // Fetch initial datasets
        refreshAll(false);

        // Dynamic automatic background refetch every 5 minutes
        if (autoRefreshInterval) clearInterval(autoRefreshInterval);
        autoRefreshInterval = setInterval(() => {
            console.log('🔄 Automatic background refresh of Analytics stats...');
            refreshAll(false);
        }, 5 * 60 * 1000);
    }

    /**
     * Fetches all analytics data from clean API endpoints and saves to Store.
     */
    async function refreshAll(manualTrigger = false) {
        const spinner = document.querySelector('.refresh-spinner');
        if (manualTrigger && spinner) {
            spinner.classList.remove('hidden');
        }

        try {
            const api = window.Dashboard.analyticsApi;
            const store = window.Dashboard.analyticsStore;
            const tenantId = 'default';

            // Fire parallel, non-blocking asynchronous requests
            const [overviewRes, providersRes, modelsRes, historyRes, liveRes, balanceRes] = await Promise.all([
                api.fetchOverview(tenantId),
                api.fetchProviders(tenantId),
                api.fetchModels(tenantId),
                api.fetchHistory(tenantId),
                api.fetchLive(tenantId),
                api.fetchOpenRouterBalance(manualTrigger).catch(err => {
                    console.warn('Failed to retrieve OpenRouter balance, fallback cached state used:', err.message);
                    return null;
                })
            ]);

            // Update store sequentially (which triggers renderUI automatically via subscriptions)
            if (overviewRes && overviewRes.success) store.setOverview(overviewRes.overview);
            if (providersRes && providersRes.success) store.setProviders(providersRes.providers);
            if (modelsRes && modelsRes.success) store.setModels(modelsRes.models);
            if (historyRes && historyRes.success) store.setHistory(historyRes.history);
            if (liveRes && liveRes.success) store.setLive(liveRes.live);
            if (balanceRes) {
                if (balanceRes.success && balanceRes.balance) {
                    store.setOpenRouterBalance(balanceRes.balance);
                } else {
                    store.setOpenRouterBalance({
                        currentBalance: null,
                        remainingBalance: null,
                        errorMessage: balanceRes.error || balanceRes.errorMessage || 'API Key is missing for OpenRouter.'
                    });
                }
            }

            // Refresh redesigned API keys limits and management list
            if (window.Dashboard.apiKeys && typeof window.Dashboard.apiKeys.loadApiKeys === 'function') {
                window.Dashboard.apiKeys.loadApiKeys();
            }

        } catch (err) {
            console.error('❌ Failed to refresh Analytics Dashboard:', err.message);
            if (window.Dashboard.settings && typeof window.Dashboard.settings.showToast === 'function') {
                window.Dashboard.settings.showToast('فشل تحديث الإحصائيات: ' + err.message, 'danger');
            }
        } finally {
            if (manualTrigger && spinner) {
                spinner.classList.add('hidden');
                if (window.Dashboard.settings && typeof window.Dashboard.settings.showToast === 'function') {
                    window.Dashboard.settings.showToast('تم تحديث كافة بيانات التحليلات بنجاح!', 'success');
                }
            }
        }
    }

    /**
     * Renders entire Analytics UI components from the store state.
     */
    function renderUI(state) {
        // 1. Update general overview widgets
        if (state.overview) {
            const o = state.overview;

            // Map the friendly required keys with robust fallbacks
            const todayRequests = o["Today's Requests"] !== undefined ? o["Today's Requests"] : 0;
            const monthRequests = o["Monthly Requests"] !== undefined ? o["Monthly Requests"] : 0;
            const totalTokens = o["Total Tokens"] !== undefined ? o["Total Tokens"] : 0;
            const totalCost = o["Total Cost"] !== undefined ? o["Total Cost"] : 0;
            const avgLatency = o["Average Latency"] !== undefined ? o["Average Latency"] : 0;

            const elTodayReq = document.getElementById('usage-overview-today-req');
            const elMonthReq = document.getElementById('usage-overview-month-req');
            const elTokens = document.getElementById('usage-overview-tokens');
            const elCost = document.getElementById('usage-overview-cost');
            const elLatency = document.getElementById('usage-overview-latency');

            if (elTodayReq) elTodayReq.innerText = Number(todayRequests).toLocaleString();
            if (elMonthReq) elMonthReq.innerText = Number(monthRequests).toLocaleString();
            if (elTokens) elTokens.innerText = Number(totalTokens).toLocaleString();
            if (elCost) elCost.innerText = `$${Number(totalCost).toFixed(4)}`;
            if (elLatency) elLatency.innerText = `${avgLatency} ms`;
        }

        // 2. Render individual provider cards
        if (state.providers) {
            const p = state.providers;

            // OpenRouter Card
            if (p.openrouter) {
                const or = p.openrouter;
                const elOrToday = document.getElementById('balance-openrouter-today');
                const elOrMonth = document.getElementById('balance-openrouter-month');
                const elOrReqs = document.getElementById('balance-openrouter-reqs');
                const elOrTokens = document.getElementById('balance-openrouter-tokens');
                const elOrLatency = document.getElementById('balance-openrouter-latency');

                if (elOrToday) elOrToday.innerText = `$${Number(or.todayCost || 0).toFixed(4)}`;
                if (elOrMonth) elOrMonth.innerText = `$${Number(or.monthlyCost || 0).toFixed(4)}`;
                if (elOrReqs) elOrReqs.innerText = Number(or.requests || 0).toLocaleString();
                if (elOrTokens) elOrTokens.innerText = `I: ${Number(or.inputTokens || or.prompt_tokens || 0).toLocaleString()} | O: ${Number(or.outputTokens || or.completion_tokens || 0).toLocaleString()}`;
                if (elOrLatency) elOrLatency.innerText = `${or.avgLatency || 0} ms`;
            }

            // OpenAI Card
            if (p.openai) {
                const oa = p.openai;
                const elOaToday = document.getElementById('balance-openai-today');
                const elOaMonth = document.getElementById('balance-openai-month');
                const elOaReqs = document.getElementById('balance-openai-reqs');
                const elOaTokens = document.getElementById('balance-openai-tokens');

                if (elOaToday) elOaToday.innerText = `$${Number(oa.todayCost || 0).toFixed(4)}`;
                if (elOaMonth) elOaMonth.innerText = `$${Number(oa.monthlyCost || 0).toFixed(4)}`;
                if (elOaReqs) elOaReqs.innerText = Number(oa.requests || 0).toLocaleString();
                if (elOaTokens) elOaTokens.innerText = Number(oa.tokens || 0).toLocaleString();
            }

            // Gemini Card
            if (p.gemini) {
                const gem = p.gemini;
                const elGemReqs = document.getElementById('balance-gemini-reqs');
                const elGemTokens = document.getElementById('balance-gemini-tokens');

                if (elGemReqs) elGemReqs.innerText = Number(gem.requests || 0).toLocaleString();
                if (elGemTokens) elGemTokens.innerText = Number(gem.tokens || 0).toLocaleString();
            }

            // Ollama Card
            if (p.ollama) {
                const oll = p.ollama;
                const elOllReqs = document.getElementById('balance-ollama-reqs');
                const elOllTokens = document.getElementById('balance-ollama-tokens');
                const elOllLatency = document.getElementById('balance-ollama-latency');

                if (elOllReqs) elOllReqs.innerText = Number(oll.requests || 0).toLocaleString();
                if (elOllTokens) elOllTokens.innerText = Number(oll.tokens || 0).toLocaleString();
                if (elOllLatency) elOllLatency.innerText = `${oll.avgLatency || 0} ms`;
            }
        }

        // 3. Render model stats table
        const tbody = document.getElementById('usage-models-table-body');
        if (tbody) {
            if (state.models && state.models.length > 0) {
                let html = '';
                state.models.forEach(m => {
                    html += `
                        <tr class="hover:bg-slate-50 transition font-mono">
                            <td class="p-3 font-semibold text-slate-800 font-sans">${m.model}</td>
                            <td class="p-3 uppercase text-slate-500 font-sans">${m.provider}</td>
                            <td class="p-3">${Number(m.requests).toLocaleString()}</td>
                            <td class="p-3 text-slate-450">${Number(m.inputTokens || m.prompt_tokens || 0).toLocaleString()}</td>
                            <td class="p-3 text-slate-450">${Number(m.outputTokens || m.completion_tokens || 0).toLocaleString()}</td>
                            <td class="p-3 font-bold">${Number(m.totalTokens).toLocaleString()}</td>
                            <td class="p-3 text-green-600 font-bold">$${Number(m.avgCost || 0).toFixed(5)}</td>
                            <td class="p-3 text-slate-600">${m.avgLatency} ms</td>
                            <td class="p-3">
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${m.successRate >= 95 ? 'bg-green-50 text-green-700' : (m.successRate >= 85 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700')}">
                                    ${m.successRate}%
                                </span>
                            </td>
                        </tr>
                    `;
                });
                tbody.innerHTML = html;
            } else {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="9" class="text-slate-400 text-center p-8 uppercase font-inter text-[10px] tracking-widest">No model usage statistics found.</td>
                    </tr>
                `;
            }
        }

        // 4. Render OpenRouter official developer balance elements
        if (state.openRouterBalance) {
            const b = state.openRouterBalance;
            const errorDiv = document.getElementById('balance-openrouter-error');
            if (errorDiv) errorDiv.classList.add('hidden');

            const current = b.currentBalance;
            const remaining = b.remainingBalance;

            const elCurrent = document.getElementById('balance-openrouter-current');
            const elRemaining = document.getElementById('balance-openrouter-remaining');

            if (elCurrent) {
                elCurrent.innerText = (current !== undefined && current !== null)
                    ? (current !== 0 ? `$${Number(current).toFixed(4)}` : 'Unlimited')
                    : 'Unavailable';
            }

            if (elRemaining) {
                elRemaining.innerText = (remaining !== undefined && remaining !== null)
                    ? (remaining !== 0 ? `$${Number(remaining).toFixed(4)}` : 'Unlimited')
                    : 'Unavailable';
            }

            if (b.errorMessage && errorDiv) {
                errorDiv.innerText = b.errorMessage;
                errorDiv.classList.remove('hidden');
            }
        }

        // 5. Draw dynamic analytical history charts
        if (state.history && state.history.length > 0) {
            const h = state.history;
            const labels = h.map(item => item.date);
            const requestsData = h.map(item => item.requests);
            const costData = h.map(item => item.cost);
            const tokensData = h.map(item => item.tokens);
            const latencyData = h.map(item => item.avg_latency || 0);

            // Requests Line Chart
            drawChart('usageChartRequests', {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'عدد الطلبات اليومية',
                        data: requestsData,
                        borderColor: '#2563EB',
                        backgroundColor: 'rgba(37, 99, 235, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true } }
                }
            });

            // Cost Line Chart
            drawChart('usageChartCost', {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'التكلفة بالدولار ($)',
                        data: costData,
                        borderColor: '#10B981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true } }
                }
            });

            // Tokens Bar Chart
            drawChart('usageChartTokens', {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Tokens المستهلكة',
                        data: tokensData,
                        backgroundColor: '#6366F1',
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true } }
                }
            });

            // Latency Line Chart
            drawChart('usageChartLatency', {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'متوسط الكمون (ms)',
                        data: latencyData,
                        borderColor: '#8B5CF6',
                        backgroundColor: 'rgba(139, 92, 246, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true } }
                }
            });
        }

        // 6. Draw Doughnut Distribution Charts
        if (state.providers) {
            const p = state.providers;
            const provLabels = ['OpenRouter', 'OpenAI', 'Gemini', 'Ollama'];
            const provRequests = [
                p.openrouter?.requests || 0,
                p.openai?.requests || 0,
                p.gemini?.requests || 0,
                p.ollama?.requests || 0
            ];

            drawChart('usageChartProviders', {
                type: 'doughnut',
                data: {
                    labels: provLabels,
                    datasets: [{
                        data: provRequests,
                        backgroundColor: ['#6366F1', '#10B981', '#3B82F6', '#9333EA']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false
                }
            });
        }

        if (state.models && state.models.length > 0) {
            const topModels = state.models.slice(0, 5); // top 5
            const modelLabels = topModels.map(m => m.model);
            const modelReqs = topModels.map(m => m.requests);

            drawChart('usageChartModels', {
                type: 'doughnut',
                data: {
                    labels: modelLabels,
                    datasets: [{
                        data: modelReqs,
                        backgroundColor: ['#3B82F6', '#EC4899', '#F59E0B', '#10B981', '#6366F1']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false
                }
            });
        }

        // 7. Render Last Updated Timestamp
        const elUpdated = document.getElementById('usage-last-updated');
        if (elUpdated) {
            const dateObj = state.lastUpdated ? new Date(state.lastUpdated) : null;
            const timestamp = (dateObj && !isNaN(dateObj)) ? dateObj.toLocaleTimeString('ar-EG') : '-';
            elUpdated.innerText = `آخر تحديث: ${timestamp}`;
        }
    }

    /**
     * Safely draws charts without overlapping artifacts by preserving instance lifecycle.
     */
    function drawChart(canvasId, config) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;

        if (charts[canvasId]) {
            charts[canvasId].destroy();
        }

        if (window.Chart) {
            charts[canvasId] = new window.Chart(ctx, config);
        }
    }

    return {
        init,
        refreshAll
    };
})();

// BACKWARD COMPATIBILITY ENDPOINTS MAPPING
// We assign these directly to keep settings.js, realtime.js, navigation.js, and main.js functioning flawlessly
window.Dashboard.aiUsage = {
    init: window.Dashboard.analyticsDashboard.init,
    refreshAll: window.Dashboard.analyticsDashboard.refreshAll
};

// Also map old general analytics functions
window.Dashboard.analytics = {
    renderAnalyticsCharts: function(platforms, messagesCount) {
        const ctxPlatform = document.getElementById('platformChart')?.getContext('2d');
        const ctxMessage = document.getElementById('messageChart')?.getContext('2d');
        if (!ctxPlatform || !ctxMessage) return;

        if (window.Dashboard.state.platformChartInstance) {
            window.Dashboard.state.platformChartInstance.destroy();
        }

        if (window.Chart) {
            window.Dashboard.state.platformChartInstance = new window.Chart(ctxPlatform, {
                type: 'doughnut',
                data: {
                    labels: ['Telegram', 'WhatsApp', 'Messenger', 'Instagram'],
                    datasets: [{
                        data: [platforms.telegram, platforms.whatsapp, platforms.messenger, platforms.instagram],
                        backgroundColor: ['#2563EB', '#10B981', '#6366F1', '#EC4899'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '75%',
                    plugins: {
                        legend: { display: false }
                    }
                }
            });
        }

        if (window.Dashboard.state.messageChartInstance) {
            window.Dashboard.state.messageChartInstance.destroy();
        }

        const dynamicMsgData = [12, 19, 6, 8, 11, 14, messagesCount];
        if (window.Chart) {
            window.Dashboard.state.messageChartInstance = new window.Chart(ctxMessage, {
                type: 'bar',
                data: {
                    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                    datasets: [{
                        label: 'Traffic',
                        data: dynamicMsgData,
                        backgroundColor: '#2563EB',
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: '#f1f5f9' },
                            ticks: { font: { family: 'Inter', size: 9 } }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { font: { family: 'Inter', size: 9 } }
                        }
                    }
                }
            });
        }
    },

    fetchStatsAndUsers: async function() {
        try {
            const statsResponse = await window.Dashboard.api.request('/api/stats');
            const stats = await statsResponse.json();

            const elUsers = document.getElementById('stat-users');
            const elMsgs = document.getElementById('stat-messages');
            const elStatus = document.getElementById('stat-status');

            if (elUsers) elUsers.innerText = stats.usersCount;
            if (elMsgs) elMsgs.innerText = stats.messagesCount;
            if (elStatus) elStatus.innerText = stats.status === 'نشط' ? 'ONLINE' : 'OFFLINE';

            const elAnUsers = document.getElementById('analytics-stat-users');
            const elAnMsgs = document.getElementById('analytics-stat-messages');

            if (elAnUsers) elAnUsers.innerText = stats.usersCount;
            if (elAnMsgs) elAnMsgs.innerText = stats.messagesCount;

            if (stats.platformsCount) {
                window.Dashboard.analytics.renderAnalyticsCharts(stats.platformsCount, stats.messagesCount);
            }

            const logsBox = document.getElementById('live-logs-box');
            if (logsBox) {
                if (stats.logs && stats.logs.length > 0) {
                    logsBox.innerHTML = stats.logs.map(log => `
                        <div class="border-b border-slate-800 pb-1 font-inter uppercase flex">
                            <span class="text-cyan-600 opacity-50">[${log.time}]</span>
                            <span class="text-cyan-400 mr-2 break-all text-[9px]">${window.Dashboard.utils.escapeHTML(log.action)}</span>
                        </div>
                    `).join('');
                } else {
                    logsBox.innerHTML = '<div class="text-slate-600 text-center py-16 uppercase">Initializing stream...</div>';
                }
            }

            const badge = document.getElementById('badge-errors-count');
            if (badge) {
                if (stats.activeErrorsCount > 0) {
                    badge.innerText = stats.activeErrorsCount;
                    badge.classList.remove('hidden');
                } else {
                    badge.classList.add('hidden');
                }
            }

            if (stats.currentModel && !window.Dashboard.state.isModelLoaded) {
                const modelSelect = document.getElementById('model-select');
                if (modelSelect) modelSelect.value = stats.currentModel;
                window.Dashboard.state.isModelLoaded = true;
            }

            if (stats.knowledgeText !== undefined && !window.Dashboard.state.isKnowledgeLoaded) {
                const knowledgeInput = document.getElementById('knowledge-input');
                if (knowledgeInput) knowledgeInput.value = stats.knowledgeText;
                window.Dashboard.state.isKnowledgeLoaded = true;
            }

            if (stats.systemPromptText !== undefined && !window.Dashboard.state.isPromptLoaded) {
                const promptInput = document.getElementById('prompt-input');
                if (promptInput) promptInput.value = stats.systemPromptText;
                window.Dashboard.state.isPromptLoaded = true;
            }

            if (stats.adminId !== undefined && !window.Dashboard.state.isAdminIdLoaded) {
                const adminInput = document.getElementById('admin-id-input');
                if (adminInput) adminInput.value = stats.adminId;
                window.Dashboard.state.isAdminIdLoaded = true;
            }

            if (stats.waAutoReply !== undefined && !window.Dashboard.state.isWaAutoReplyLoaded) {
                const selectAutoreply = document.getElementById('wa-autoreply-select');
                if (selectAutoreply) selectAutoreply.value = stats.waAutoReply ? "true" : "false";
                window.Dashboard.state.isWaAutoReplyLoaded = true;
            }

            if (stats.aiCustomModels !== undefined) {
                try {
                    const parsed = JSON.parse(stats.aiCustomModels);
                    if (Array.isArray(parsed)) {
                        if (0 >= (window.Dashboard.state.customModelsTimestamp || 0)) {
                            window.Dashboard.state.customModels = parsed;
                            window.Dashboard.state.customModelsTimestamp = 0;
                        }
                    } else if (parsed && typeof parsed === 'object' && parsed.models) {
                        const incomingTimestamp = parsed.updatedAt || 0;
                        if (incomingTimestamp >= (window.Dashboard.state.customModelsTimestamp || 0)) {
                            window.Dashboard.state.customModels = parsed.models;
                            window.Dashboard.state.customModelsTimestamp = incomingTimestamp;
                        }
                    }
                } catch(e) {
                    console.warn("Failed to parse custom models:", e);
                }
            }

            if (stats.aiProvider !== undefined && !window.Dashboard.state.isAiProviderLoaded) {
                const provSelect = document.getElementById('ai-provider-select');
                if (provSelect) {
                    provSelect.value = stats.aiProvider;
                    provSelect.dispatchEvent(new Event('change'));
                }
                window.Dashboard.state.isAiProviderLoaded = true;
            }

            if (stats.aiBaseUrl !== undefined && !window.Dashboard.state.isAiBaseUrlLoaded) {
                const baseUrlInput = document.getElementById('ai-base-url-input');
                if (baseUrlInput) baseUrlInput.value = stats.aiBaseUrl;
                window.Dashboard.state.isAiBaseUrlLoaded = true;
            }

            if (stats.aiApiKey !== undefined && !window.Dashboard.state.isAiApiKeyLoaded) {
                const openrouterInput = document.getElementById('openrouter-input');
                if (openrouterInput) openrouterInput.value = stats.aiApiKey;
                window.Dashboard.state.isAiApiKeyLoaded = true;
                window.Dashboard.state.isOpenRouterLoaded = true;
            }

            if (stats.aiModel !== undefined && !window.Dashboard.state.isAiModelLoaded) {
                const modelSelect = document.getElementById('model-select');
                if (modelSelect) {
                    window.Dashboard.state.pendingLoadedModel = stats.aiModel;
                    const currentProv = document.getElementById('ai-provider-select').value;
                    if (window.Dashboard.settings && window.Dashboard.settings.populateModelsDropdown) {
                        window.Dashboard.settings.populateModelsDropdown(currentProv);
                    }
                }
                window.Dashboard.state.isAiModelLoaded = true;
                window.Dashboard.state.isModelLoaded = true;
            }

            if (stats.openrouterKey !== undefined && !window.Dashboard.state.isOpenRouterLoaded) {
                const openrouterInput = document.getElementById('openrouter-input');
                if (openrouterInput) openrouterInput.value = stats.openrouterKey;
                window.Dashboard.state.isOpenRouterLoaded = true;
            }
            if (stats.telegramToken !== undefined && !window.Dashboard.state.isTelegramTokenLoaded) {
                const tokenInput = document.getElementById('token-input');
                if (tokenInput) tokenInput.value = stats.telegramToken;
                window.Dashboard.state.isTelegramTokenLoaded = true;
            }

            if (stats.metaVerifyToken !== undefined && !window.Dashboard.state.isMetaVerifyLoaded) {
                const metaVerifyInput = document.getElementById('meta-verify-input');
                if (metaVerifyInput) metaVerifyInput.value = stats.metaVerifyToken;
                window.Dashboard.state.isMetaVerifyLoaded = true;
            }
            if (stats.messengerToken !== undefined && !window.Dashboard.state.isMessengerLoaded) {
                const messengerTokenInput = document.getElementById('messenger-token-input');
                if (messengerTokenInput) messengerTokenInput.value = stats.messengerToken;
                window.Dashboard.state.isMessengerLoaded = true;
            }
            if (stats.instagramToken !== undefined && !window.Dashboard.state.isInstagramLoaded) {
                const instagramTokenInput = document.getElementById('instagram-token-input');
                if (instagramTokenInput) instagramTokenInput.value = stats.instagramToken;
                window.Dashboard.state.isInstagramLoaded = true;
            }

            if (stats.messengerAutoReply !== undefined && !window.Dashboard.state.isMessengerAutoReplyLoaded) {
                const selectMessengerAutoreply = document.getElementById('messenger-autoreply-select');
                if (selectMessengerAutoreply) selectMessengerAutoreply.value = stats.messengerAutoReply ? "true" : "false";
                window.Dashboard.state.isMessengerAutoReplyLoaded = true;
            }
            if (stats.instagramAutoReply !== undefined && !window.Dashboard.state.isInstagramAutoReplyLoaded) {
                const selectInstagramAutoreply = document.getElementById('instagram-autoreply-select');
                if (selectInstagramAutoreply) selectInstagramAutoreply.value = stats.instagramAutoReply ? "true" : "false";
                window.Dashboard.state.isInstagramAutoReplyLoaded = true;
            }

            if (stats.ragChunkSize !== undefined && !window.Dashboard.state.isRagChunkSizeLoaded) {
                const input = document.getElementById('rag-chunk-size-input');
                if (input) input.value = stats.ragChunkSize;
                window.Dashboard.state.isRagChunkSizeLoaded = true;
            }
            if (stats.ragChunkOverlap !== undefined && !window.Dashboard.state.isRagChunkOverlapLoaded) {
                const input = document.getElementById('rag-chunk-overlap-input');
                if (input) input.value = stats.ragChunkOverlap;
                window.Dashboard.state.isRagChunkOverlapLoaded = true;
            }
            if (stats.ragEmbeddingModel !== undefined && !window.Dashboard.state.isRagEmbeddingModelLoaded) {
                const input = document.getElementById('rag-embedding-model-input');
                if (input) input.value = stats.ragEmbeddingModel;
                window.Dashboard.state.isRagEmbeddingModelLoaded = true;
            }
            if (stats.qdrantCollection !== undefined && !window.Dashboard.state.isQdrantCollectionLoaded) {
                const input = document.getElementById('qdrant-collection-input');
                if (input) input.value = stats.qdrantCollection;
                window.Dashboard.state.isQdrantCollectionLoaded = true;
            }
            if (stats.qdrantUrl !== undefined && !window.Dashboard.state.isQdrantUrlLoaded) {
                const input = document.getElementById('qdrant-url-input');
                if (input) input.value = stats.qdrantUrl;
                window.Dashboard.state.isQdrantUrlLoaded = true;
            }
            if (stats.ollamaBaseUrl !== undefined && !window.Dashboard.state.isOllamaBaseUrlLoaded) {
                const input = document.getElementById('ollama-url-input');
                if (input) input.value = stats.ollamaBaseUrl;
                window.Dashboard.state.isOllamaBaseUrlLoaded = true;
            }
            if (stats.ragIndexOnStartup !== undefined && !window.Dashboard.state.isRagIndexOnStartupLoaded) {
                const select = document.getElementById('rag-index-startup-select');
                if (select) select.value = stats.ragIndexOnStartup ? "true" : "false";
                window.Dashboard.state.isRagIndexOnStartupLoaded = true;
            }
            if (stats.ragLegacyFallback !== undefined && !window.Dashboard.state.isRagLegacyFallbackLoaded) {
                const select = document.getElementById('rag-legacy-fallback-select');
                if (select) select.value = stats.ragLegacyFallback ? "true" : "false";
                window.Dashboard.state.isRagLegacyFallbackLoaded = true;
            }
            if (stats.ragNeighborExpansion !== undefined && !window.Dashboard.state.isRagNeighborExpansionLoaded) {
                const select = document.getElementById('rag-neighbor-expansion-select');
                if (select) select.value = stats.ragNeighborExpansion ? "true" : "false";
                window.Dashboard.state.isRagNeighborExpansionLoaded = true;
            }
            if (stats.ragContextBudget !== undefined && !window.Dashboard.state.isRagContextBudgetLoaded) {
                const input = document.getElementById('rag-context-budget-input');
                if (input) input.value = stats.ragContextBudget;
                window.Dashboard.state.isRagContextBudgetLoaded = true;
            }
            if (stats.ragMinTopK !== undefined && !window.Dashboard.state.isRagMinTopKLoaded) {
                const input = document.getElementById('rag-min-top-k-input');
                if (input) input.value = stats.ragMinTopK;
                window.Dashboard.state.isRagMinTopKLoaded = true;
            }
            if (stats.ragDefaultTopK !== undefined && !window.Dashboard.state.isRagDefaultTopKLoaded) {
                const input = document.getElementById('rag-default-top-k-input');
                if (input) input.value = stats.ragDefaultTopK;
                window.Dashboard.state.isRagDefaultTopKLoaded = true;
            }
            if (stats.ragMaxTopK !== undefined && !window.Dashboard.state.isRagMaxTopKLoaded) {
                const input = document.getElementById('rag-max-top-k-input');
                if (input) input.value = stats.ragMaxTopK;
                window.Dashboard.state.isRagMaxTopKLoaded = true;
            }
            if (stats.ragCandidateMultiplier !== undefined && !window.Dashboard.state.isRagCandidateMultiplierLoaded) {
                const input = document.getElementById('rag-candidate-multiplier-input');
                if (input) input.value = stats.ragCandidateMultiplier;
                window.Dashboard.state.isRagCandidateMultiplierLoaded = true;
            }
            if (stats.ragSemanticWeight !== undefined && !window.Dashboard.state.isRagSemanticWeightLoaded) {
                const input = document.getElementById('rag-semantic-weight-input');
                if (input) input.value = stats.ragSemanticWeight;
                window.Dashboard.state.isRagSemanticWeightLoaded = true;
            }
            if (stats.ragKeywordWeight !== undefined && !window.Dashboard.state.isRagKeywordWeightLoaded) {
                const input = document.getElementById('rag-keyword-weight-input');
                if (input) input.value = stats.ragKeywordWeight;
                window.Dashboard.state.isRagKeywordWeightLoaded = true;
            }
            if (stats.ragSimilarityThreshold !== undefined && !window.Dashboard.state.isRagSimilarityThresholdLoaded) {
                const input = document.getElementById('rag-similarity-threshold-input');
                if (input) input.value = stats.ragSimilarityThreshold;
                window.Dashboard.state.isRagSimilarityThresholdLoaded = true;
            }

            const usersResponse = await window.Dashboard.api.request('/api/users');
            window.Dashboard.state.usersCache = await usersResponse.json();
            if (window.Dashboard.users && window.Dashboard.users.renderUsersList) {
                window.Dashboard.users.renderUsersList();
            }
        } catch (err) {
            console.error(err);
        }
    }
};

// Global bindings
window.renderAnalyticsCharts = window.Dashboard.analytics.renderAnalyticsCharts;
window.fetchStatsAndUsers = window.Dashboard.analytics.fetchStatsAndUsers;
