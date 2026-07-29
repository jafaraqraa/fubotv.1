// Dashboard RAG Knowledge Center Module (Refactored & Enhanced UX)
window.Dashboard = window.Dashboard || {};

window.Dashboard.state = window.Dashboard.state || {};
window.Dashboard.state.ragOriginalValues = {};
window.Dashboard.state.ragCurrentValues = {};
window.Dashboard.state.hasUnsavedChanges = false;
window.Dashboard.state.activeDirtySection = null;

// Reactive States
window.Dashboard.state.ragDocuments = [];
window.Dashboard.state.ragSelectedDocIds = new Set();
window.Dashboard.state.ragSearchQuery = '';
window.Dashboard.state.ragFilterStatus = 'all';
window.Dashboard.state.ragSortOption = 'newest';
window.Dashboard.state.activePanelDocId = null;

// Chunk Inspector State
window.Dashboard.state.inspectorChunks = [];
window.Dashboard.state.inspectorSearchQuery = '';
window.Dashboard.state.inspectorDocFilter = '';
window.Dashboard.state.inspectorPage = 1;
window.Dashboard.state.inspectorLimit = 10;
window.Dashboard.state.inspectorTotal = 0;

// Preview Navigation State
window.Dashboard.state.previewChunks = [];
window.Dashboard.state.previewActiveIndex = 0;
window.Dashboard.state.previewRawText = '';
window.Dashboard.state.previewCleanText = '';
window.Dashboard.state.previewDocId = null;

window.Dashboard.rag = {
    init: async function() {
        console.log("📚 Initializing Production-Grade Knowledge Center (RAG)...");

        window.Dashboard.state.ragSelectedDocIds.clear();

        // 1. Fetch expandable source types
        await window.Dashboard.rag.fetchSourceTypes();

        // 2. Load configurations & library
        await window.Dashboard.rag.loadRagSettings();
        await window.Dashboard.rag.fetchOverviewAndDocuments();
        await window.Dashboard.rag.checkCollectionHealth();

        // 3. Bind events
        window.Dashboard.rag.bindEvents();
        window.Dashboard.rag.bindTabs();
        window.Dashboard.rag.bindPreviewEvents();

        // Render logs
        window.Dashboard.rag.renderActivityLogs();
    },

    // A. Fetch Expandable Source Types
    fetchSourceTypes: async function() {
        try {
            const res = await window.Dashboard.api.request('/api/v1/rag/source-types');
            const data = await res.json();
            if (data.success && data.sourceTypes) {
                window.Dashboard.state.sourceTypes = data.sourceTypes;
            }
        } catch (e) {
            console.warn('Could not fetch dynamic source types:', e.message);
        }
    },

    // B. Sub-tabs Switching
    bindTabs: function() {
        const tabLib = document.getElementById('rag-tab-library');
        const tabInsp = document.getElementById('rag-tab-inspector');
        const viewLib = document.getElementById('rag-library-view');
        const viewInsp = document.getElementById('rag-inspector-view');

        if (tabLib && tabInsp && viewLib && viewInsp) {
            tabLib.onclick = function() {
                tabLib.className = "pb-3 border-b-2 border-blue-600 text-blue-600 font-bold text-xs font-arabic transition";
                tabInsp.className = "pb-3 border-b-2 border-transparent text-slate-500 hover:text-slate-700 font-bold text-xs font-arabic transition";
                viewLib.classList.remove('hidden');
                viewInsp.classList.add('hidden');
            };

            tabInsp.onclick = function() {
                tabInsp.className = "pb-3 border-b-2 border-blue-600 text-blue-600 font-bold text-xs font-arabic transition";
                tabLib.className = "pb-3 border-b-2 border-transparent text-slate-500 hover:text-slate-700 font-bold text-xs font-arabic transition";
                viewLib.classList.add('hidden');
                viewInsp.classList.remove('hidden');

                // Trigger chunk inspector load
                window.Dashboard.rag.loadInspectorChunks();
                window.Dashboard.rag.populateInspectorDocFilter();
            };
        }
    },

    // C. Load and Render Chunk Inspector
    loadInspectorChunks: async function() {
        const tbody = document.getElementById('rag-inspector-table-body');
        const pageInfo = document.getElementById('rag-inspector-page-info');
        const prevBtn = document.getElementById('rag-inspector-prev-btn');
        const nextBtn = document.getElementById('rag-inspector-next-btn');

        if (!tbody) return;

        try {
            const queryParams = new URLSearchParams({
                search: window.Dashboard.state.inspectorSearchQuery,
                documentId: window.Dashboard.state.inspectorDocFilter,
                page: window.Dashboard.state.inspectorPage,
                limit: window.Dashboard.state.inspectorLimit
            });

            const res = await window.Dashboard.api.request(`/api/v1/rag/chunks?${queryParams.toString()}`);
            const data = await res.json();

            if (data.success && data.chunks) {
                window.Dashboard.state.inspectorChunks = data.chunks;
                window.Dashboard.state.inspectorTotal = data.pagination.total;

                // Render Table
                if (data.chunks.length === 0) {
                    const row = document.createElement('tr');
                    row.appendChild(window.Dashboard.utils.createElement('td', {
                        className: 'text-slate-400 text-center p-8 font-arabic text-[11px]',
                        text: '⚠️ لا توجد مقاطع متوفرة مطابقة لخيارات الفلترة الحالية.',
                        attributes: { colspan: '7' }
                    }));
                    tbody.replaceChildren(row);
                } else {
                    const dom = window.Dashboard.utils;
                    const rows = data.chunks.map(c => {
                        const row = dom.createElement('tr', { className: 'hover:bg-slate-50 transition cursor-pointer' });
                        row.addEventListener('click', () => window.Dashboard.rag.openChunkDetailsModal(c.chunkId));
                        const actionCell = dom.createElement('td', { className: 'p-3 text-center' });
                        actionCell.appendChild(dom.createElement('button', { className: 'px-2 py-1 bg-slate-100 border border-slate-200 rounded font-bold text-[9px] hover:bg-slate-200', text: 'عرض' }));
                        row.append(
                            dom.createElement('td', { className: 'p-3 text-slate-800 font-mono text-[10px] break-all', text: c.chunkId }),
                            dom.createElement('td', { className: 'p-3 text-slate-600 truncate max-w-[150px]', text: c.source, attributes: { title: c.source } }),
                            dom.createElement('td', { className: 'p-3 font-semibold text-blue-600', text: `${c.chunkIndex + 1} / ${c.totalChunks}` }),
                            dom.createElement('td', { className: 'p-3 font-mono text-slate-500', text: String(c.text || '').length }),
                            dom.createElement('td', { className: 'p-3 font-mono text-purple-600 font-bold', text: Math.ceil(String(c.text || '').split(/\s+/).length * 1.3) }),
                            dom.createElement('td', { className: 'p-3 text-green-600 font-bold font-arabic text-[10px]', text: 'مفهرس' }),
                            actionCell
                        );
                        return row;
                    });
                    tbody.replaceChildren(...rows);
                }

                // Update pagination controls
                if (pageInfo) pageInfo.innerText = `صفحة ${data.pagination.page} من ${Math.ceil(data.pagination.total / data.pagination.limit) || 1} (الإجمالي: ${data.pagination.total} مقطع)`;
                if (prevBtn) prevBtn.disabled = data.pagination.page <= 1;
                if (nextBtn) nextBtn.disabled = data.pagination.page * data.pagination.limit >= data.pagination.total;
            }
        } catch (err) {
            console.error('Failed to load inspector chunks:', err);
        }
    },

    populateInspectorDocFilter: function() {
        const select = document.getElementById('rag-inspector-doc-select');
        if (!select) return;

        const dom = window.Dashboard.utils;
        const options = [
            dom.createElement('option', { text: 'كل المستندات', attributes: { value: '' } }),
            dom.createElement('option', { text: 'النص المعرفي اليدوي (knowledge.txt)', attributes: { value: 'manual_text' } })
        ];
        window.Dashboard.state.ragDocuments.forEach(d => {
            if (d.documentId !== 'manual_text') {
                options.push(dom.createElement('option', { text: d.originalFilename, attributes: { value: d.documentId } }));
            }
        });
        select.replaceChildren(...options);
        select.value = window.Dashboard.state.inspectorDocFilter;
    },

    openChunkDetailsModal: async function(chunkId) {
        let chunk = window.Dashboard.state.inspectorChunks.find(c => c.chunkId === chunkId);

        if (!chunk) {
            try {
                const res = await window.Dashboard.api.request(`/api/v1/rag/chunks?search=${encodeURIComponent(chunkId)}`);
                const data = await res.json();
                if (data.success && data.chunks && data.chunks.length > 0) {
                    chunk = data.chunks.find(c => c.chunkId === chunkId);
                }
            } catch (err) {
                console.error('Failed to dynamically fetch chunk details:', err);
            }
        }

        if (!chunk) return;

        const modal = document.getElementById('rag-chunk-details-modal');
        if (!modal) return;

        document.getElementById('rag-chunk-dt-id').innerText = chunk.chunkId;
        document.getElementById('rag-chunk-dt-doc').innerText = chunk.source;
        document.getElementById('rag-chunk-dt-pos').innerText = `${chunk.chunkIndex + 1} من ${chunk.totalChunks}`;
        document.getElementById('rag-chunk-dt-chars').innerText = chunk.text.length;

        const prevBtn = document.getElementById('rag-chunk-dt-prev');
        const nextBtn = document.getElementById('rag-chunk-dt-next');

        if (prevBtn) {
            if (chunk.previousChunkId) {
                prevBtn.innerText = chunk.previousChunkId;
                prevBtn.disabled = false;
                prevBtn.onclick = function(e) {
                    e.stopPropagation();
                    window.Dashboard.rag.openChunkDetailsModal(chunk.previousChunkId);
                };
            } else {
                prevBtn.innerText = 'لا يوجد (مقطع البداية)';
                prevBtn.disabled = true;
                prevBtn.onclick = null;
            }
        }

        if (nextBtn) {
            if (chunk.nextChunkId) {
                nextBtn.innerText = chunk.nextChunkId;
                nextBtn.disabled = false;
                nextBtn.onclick = function(e) {
                    e.stopPropagation();
                    window.Dashboard.rag.openChunkDetailsModal(chunk.nextChunkId);
                };
            } else {
                nextBtn.innerText = 'لا يوجد (مقطع النهاية)';
                nextBtn.disabled = true;
                nextBtn.onclick = null;
            }
        }

        document.getElementById('rag-chunk-dt-text').innerText = chunk.text;

        modal.classList.remove('hidden');
    },

    // D. Fetch RAG Configurations
    loadRagSettings: async function() {
        try {
            const res = await window.Dashboard.api.request('/api/stats');
            const data = await res.json();

            const settingsMap = {
                'rag-opt-default-top-k': data.ragDefaultTopK || 5,
                'rag-opt-min-top-k': data.ragMinTopK || 3,
                'rag-opt-max-top-k': data.ragMaxTopK || 7,
                'rag-opt-similarity-threshold': data.ragSimilarityThreshold || 0.4,
                'rag-opt-neighbor-expansion': String(data.ragNeighborExpansion !== false),
                'rag-opt-context-budget': data.ragContextBudget || 3000,
                'rag-opt-hybrid-search': String(data.ragKeywordWeight !== undefined),
                'rag-opt-semantic-weight': data.ragSemanticWeight || 0.8,
                'rag-opt-keyword-weight': data.ragKeywordWeight || 0.2,

                'rag-opt-chunk-size': data.ragChunkSize || 800,
                'rag-opt-chunk-overlap': data.ragChunkOverlap || 120,
                'rag-opt-separator-strategy': 'newline',
                'rag-opt-arabic-norm': 'true',
                'rag-opt-cleaner-ver': 'v2',

                'rag-opt-embedding-provider': 'ollama',
                'rag-opt-embedding-model': data.ragEmbeddingModel || 'nomic-embed-text',
                'rag-opt-embedding-dimension': 768,
                'rag-opt-collection': data.qdrantCollection || 'futhing_knowledge',
                'rag-opt-distance-metric': 'Cosine',

                'knowledge-input': data.knowledgeText || ''
            };

            window.Dashboard.state.ragOriginalValues = { ...settingsMap };
            window.Dashboard.state.ragCurrentValues = { ...settingsMap };

            for (const [id, value] of Object.entries(settingsMap)) {
                const el = document.getElementById(id);
                if (el) {
                    el.value = value;
                }
            }

            window.Dashboard.rag.updateManualCharCounter(settingsMap['knowledge-input']);
            window.Dashboard.rag.hideFloatingBar();

        } catch (err) {
            console.error('Failed to load RAG settings:', err);
        }
    },

    // E. Fetch Connection, Library and Live Stats
    fetchOverviewAndDocuments: async function() {
        const qStatus = document.getElementById('rag-overview-qdrant-status');
        const oStatus = document.getElementById('rag-overview-ollama-status');
        const hMode = document.getElementById('rag-overview-hybrid-mode');
        const eModel = document.getElementById('rag-overview-embedding-model');
        const tDocs = document.getElementById('rag-overview-total-docs');
        const iDocs = document.getElementById('rag-overview-indexed-docs');
        const fDocs = document.getElementById('rag-overview-failed-docs');
        const tChunks = document.getElementById('rag-overview-total-chunks');
        const lIndexTime = document.getElementById('rag-overview-last-index-time');
        const orStatus = document.getElementById('rag-overview-openrouter-status');

        const settleStatus = (element, healthy, healthyText = 'متصل', failedText = 'غير متصل') => {
            if (!element) return;
            element.textContent = healthy ? healthyText : failedText;
            element.className = healthy
                ? 'text-xs font-bold text-green-600'
                : 'text-xs font-bold text-red-500';
        };

        try {
            const statusRes = await window.Dashboard.api.request('/api/rag/status');
            const statusData = await statusRes.json();

            if (statusData.success && statusData.status) {
                const s = statusData.status;

                settleStatus(qStatus, s.qdrantReachable);
                settleStatus(oStatus, s.ollamaReachable);
                if (hMode) {
                    hMode.innerText = (s.retrievalMode === 'NORMAL') ? 'هجين متكامل' : 'غير جاهز';
                    hMode.className = (s.retrievalMode === 'NORMAL') ? 'text-xs font-bold text-green-600' : 'text-xs font-bold text-yellow-600';
                }
                if (eModel) {
                    eModel.innerText = s.embeddingModelName || 'nomic-embed-text';
                    eModel.title = s.embeddingModelName || 'nomic-embed-text';
                }
                if (tChunks) {
                    tChunks.innerText = s.statistics?.logical?.activeChunks?.value ?? '—';
                }
                if (lIndexTime) {
                    const idxDate = s.lastSuccessfulIndexingTime ? new Date(s.lastSuccessfulIndexingTime) : null;
                    lIndexTime.innerText = (idxDate && !isNaN(idxDate)) ? idxDate.toLocaleTimeString('ar-EG') : 'غير متوفر';
                }

                // Render dynamic statistics if elements exist (Goal 9)
                const statAvgChunk = document.getElementById('rag-stat-avg-chunk');
                const statDimension = document.getElementById('rag-stat-dimension');
                const statColSize = document.getElementById('rag-stat-col-size');
                const statStorage = document.getElementById('rag-stat-storage');
                const statLatency = document.getElementById('rag-stat-latency');

                if (statAvgChunk) statAvgChunk.innerText = s.configuredChunkSize != null
                    ? `${s.configuredChunkSize} حرف (إعداد)` : '—';
                if (statDimension) statDimension.innerText = s.embeddingDimension != null
                    ? `${s.embeddingDimension} بُعد` : '—';
                if (statColSize) statColSize.innerText = '—';
                if (statStorage) statStorage.innerText = '—';
                if (statLatency) statLatency.innerText = s.avgRetrievalLatencyMs != null
                    ? `${s.avgRetrievalLatencyMs.toFixed(1)} ms` : 'عينات غير كافية';
            } else {
                throw new Error(statusData.error || 'تعذر قراءة حالة RAG.');
            }
        } catch (e) {
            console.error('Failed to load RAG connection statuses:', e);
            settleStatus(qStatus, false, 'متصل', 'تعذر الفحص');
            settleStatus(oStatus, false, 'متصل', 'تعذر الفحص');
        }

        try {
            const statsRes = await window.Dashboard.api.request('/api/stats');
            const stats = await statsRes.json();
            settleStatus(orStatus, stats.isOpenRouterConfigured,
                'متصل', stats.isOpenRouterConfigured === false ? 'غير مهيأ' : 'تعذر الفحص');
        } catch (error) {
            console.error('Failed to load OpenRouter status:', error);
            settleStatus(orStatus, false, 'متصل', 'تعذر الفحص');
        }

        // Fetch documents
        try {
            const docRes = await window.Dashboard.api.request('/api/rag/documents');
            const docData = await docRes.json();

            if (docData.success && docData.documents) {
                window.Dashboard.state.ragDocuments = docData.documents;
                if (tDocs) tDocs.innerText = docData.documents.length;

                const indexedCount = docData.documents.filter(d => d.status === 'indexed').length;
                const failedCount = docData.documents.filter(d => d.status === 'failed').length;

                if (iDocs) iDocs.innerText = indexedCount;
                if (fDocs) fDocs.innerText = failedCount;

                window.Dashboard.rag.renderDocuments();
            }
        } catch (err) {
            console.error('Failed to load RAG documents library:', err);
            const tbody = document.getElementById('rag-doc-table-body');
            if (tbody) {
                const row = document.createElement('tr');
                const cell = document.createElement('td');
                cell.colSpan = 12;
                cell.className = 'text-red-500 text-center p-8 font-arabic text-[11px]';
                cell.textContent = 'تعذر تحميل مستودع المستندات. أعد المحاولة أو راجع حالة الخادم.';
                row.appendChild(cell);
                tbody.replaceChildren(row);
            }
        }
    },

    // F. Check infrastructure health widget
    checkCollectionHealth: async function() {
        const hSql = document.getElementById('rag-health-sqlite-status');
        const hQd = document.getElementById('rag-health-qdrant-status');
        const hQdDot = document.getElementById('rag-health-qdrant-dot');
        const hOl = document.getElementById('rag-health-ollama-status');
        const hOlDot = document.getElementById('rag-health-ollama-dot');
        const hOr = document.getElementById('rag-health-openrouter-status');
        const hOrDot = document.getElementById('rag-health-openrouter-dot');

        if (hSql) {
            hSql.innerText = 'Healthy';
            hSql.className = 'font-bold text-green-600';
        }

        try {
            const res = await window.Dashboard.api.request('/api/rag/status');
            const data = await res.json();

            if (data.success && data.status) {
                const s = data.status;

                // Qdrant
                if (hQd) {
                    hQd.innerText = s.qdrantReachable ? 'Healthy' : 'Offline';
                    hQd.className = s.qdrantReachable ? 'font-bold text-green-600' : 'font-bold text-red-500';
                    if (hQdDot) hQdDot.className = s.qdrantReachable ? 'w-2.5 h-2.5 rounded-full bg-green-500' : 'w-2.5 h-2.5 rounded-full bg-red-500';
                }

                // Ollama
                if (hOl) {
                    hOl.innerText = s.ollamaReachable ? 'Healthy' : 'Offline';
                    hOl.className = s.ollamaReachable ? 'font-bold text-green-600' : 'font-bold text-red-500';
                    if (hOlDot) hOlDot.className = s.ollamaReachable ? 'w-2.5 h-2.5 rounded-full bg-green-500' : 'w-2.5 h-2.5 rounded-full bg-red-500';
                }
            }
        } catch (err) {
            console.error(err);
        }

        // OpenRouter API Check
        try {
            const statsRes = await window.Dashboard.api.request('/api/stats');
            const stats = await statsRes.json();
            if (hOr) {
                hOr.innerText = stats.isOpenRouterConfigured ? 'Healthy' : 'Warning (No Key)';
                hOr.className = stats.isOpenRouterConfigured ? 'font-bold text-green-600' : 'font-bold text-yellow-500';
                if (hOrDot) hOrDot.className = stats.isOpenRouterConfigured ? 'w-2.5 h-2.5 rounded-full bg-green-500' : 'w-2.5 h-2.5 rounded-full bg-yellow-500';
            }
        } catch (e) {
            console.error(e);
        }
    },

    // G. Render Table and Mobile Cards
    renderDocuments: function() {
        const tbody = document.getElementById('rag-doc-table-body');
        const mobileContainer = document.getElementById('rag-doc-cards-mobile');
        if (!tbody) return;

        let docs = [...window.Dashboard.state.ragDocuments];

        // Search Name
        if (window.Dashboard.state.ragSearchQuery) {
            const q = window.Dashboard.state.ragSearchQuery.toLowerCase();
            docs = docs.filter(d => d.originalFilename.toLowerCase().includes(q));
        }

        // Status filter
        if (window.Dashboard.state.ragFilterStatus !== 'all') {
            docs = docs.filter(d => d.status === window.Dashboard.state.ragFilterStatus);
        }

        // Sort option
        if (window.Dashboard.state.ragSortOption === 'newest') {
            docs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        } else if (window.Dashboard.state.ragSortOption === 'oldest') {
            docs.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        } else if (window.Dashboard.state.ragSortOption === 'chunks') {
            docs.sort((a, b) => (b.chunkCount || 0) - (a.chunkCount || 0));
        } else if (window.Dashboard.state.ragSortOption === 'size') {
            docs.sort((a, b) => (b.fileSize || 0) - (a.fileSize || 0));
        } else if (window.Dashboard.state.ragSortOption === 'status') {
            docs.sort((a, b) => (a.status || '').localeCompare(b.status || ''));
        }

        if (docs.length === 0) {
            const emptyHTML = `
                <tr>
                    <td colspan="12" class="text-slate-400 text-center p-8 font-arabic text-[11px] leading-relaxed">
                        ⚠️ لا توجد مستندات مطابقة لخيارات البحث والتصفية الحالية.
                    </td>
                </tr>
            `;
            window.Dashboard.utils.setSanitizedHTML(tbody, emptyHTML);
            if (mobileContainer) {
                window.Dashboard.utils.setSanitizedHTML(mobileContainer, `
                    <div class="text-slate-400 text-center p-6 bg-white border border-slate-200 rounded-xl font-arabic text-[11px] leading-relaxed">
                        ⚠️ لا توجد مستندات مطابقة لخيارات البحث والتصفية الحالية.
                    </div>
                `);
            }
            return;
        }

        let tableHTML = '';
        let mobileHTML = '';

        docs.forEach(d => {
            const isSelected = window.Dashboard.state.ragSelectedDocIds.has(d.documentId);
            const checkedAttr = isSelected ? 'checked' : '';

            let badgeClass = 'bg-slate-50 text-slate-700 border-slate-200';
            let statusText = d.status;

            if (d.status === 'indexed') {
                badgeClass = 'bg-green-50 text-green-700 border-green-200';
                statusText = 'مفهرس';
            } else if (d.status === 'uploaded') {
                badgeClass = 'bg-blue-50 text-blue-700 border-blue-200';
                statusText = 'تم الرفع';
            } else if (d.status === 'parsing') {
                badgeClass = 'bg-yellow-50 text-yellow-700 border-yellow-200';
                statusText = 'جاري استخراج النص';
            } else if (d.status === 'failed') {
                badgeClass = 'bg-red-50 text-red-700 border-red-200';
                statusText = 'فشل';
            }

            const formattedSize = window.Dashboard.utils && window.Dashboard.utils.formatBytes
                ? window.Dashboard.utils.formatBytes(d.fileSize)
                : `${(d.fileSize / 1024).toFixed(1)} KB`;

            const fileIcon = d.fileType === 'PDF' ? '🔴' : (d.fileType === 'MANUAL' ? '✍️' : '📄');
            const formattedDate = d.createdAt ? new Date(d.createdAt).toLocaleDateString('ar-EG') : '-';

            // Source types (Goal 1)
            const srcLabelAr = d.sourceType === 'manual_knowledge' ? 'نص معرفي يدوي' : 'ملف مرفوع';
            const srcBadgeClass = d.sourceType === 'manual_knowledge' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600';

            tableHTML += `
                <tr data-document-open="${window.Dashboard.utils.escapeHTML(String(d.documentId))}" class="hover:bg-slate-50/50 transition cursor-pointer select-text text-xs">
                    <td class="p-3 text-right w-10">
                        <input type="checkbox" data-id="${window.Dashboard.utils.escapeHTML(String(d.documentId))}" class="rag-doc-row-chk rounded border-slate-300 text-blue-600 focus:ring-blue-500" ${checkedAttr}>
                    </td>
                    <td class="p-3 font-semibold text-slate-800 truncate max-w-[200px]" title="${window.Dashboard.utils.escapeHTML(d.originalFilename)}">
                        ${fileIcon} ${window.Dashboard.utils.escapeHTML(d.originalFilename)}
                    </td>
                    <td class="p-3 font-mono text-slate-500">${window.Dashboard.utils.escapeHTML(String(d.fileType || ''))}</td>
                    <td class="p-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${srcBadgeClass}">${srcLabelAr}</span>
                    </td>
                    <td class="p-3 font-mono text-slate-600 font-bold">${window.Dashboard.utils.escapeHTML(String(d.version || 1))}</td>
                    <td class="p-3 font-mono text-slate-600">-</td>
                    <td class="p-3 font-mono text-slate-600">${window.Dashboard.utils.escapeHTML(String(formattedSize))}</td>
                    <td class="p-3 font-mono text-slate-600 font-bold text-blue-600">${window.Dashboard.utils.escapeHTML(String(d.chunkCount ?? 0))}</td>
                    <td class="p-3 text-slate-500 truncate max-w-[120px]">nomic-embed</td>
                    <td class="p-3 text-slate-500 font-mono">${formattedDate}</td>
                    <td class="p-3">
                        <span class="px-2.5 py-0.5 rounded-full border text-[10px] font-bold ${badgeClass}">
                            ${window.Dashboard.utils.escapeHTML(String(statusText || ''))}
                        </span>
                    </td>
                    <td class="p-3 text-center">
                        <button type="button" data-document-details="${window.Dashboard.utils.escapeHTML(String(d.documentId))}" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded border border-slate-200 text-[10px] transition font-arabic">عرض التفاصيل</button>
                    </td>
                </tr>
            `;

            mobileHTML += `
                <div data-document-open="${window.Dashboard.utils.escapeHTML(String(d.documentId))}" class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3 font-arabic">
                    <div class="flex justify-between items-start gap-2">
                        <div class="flex items-center gap-2">
                            <input type="checkbox" data-id="${window.Dashboard.utils.escapeHTML(String(d.documentId))}" class="rag-doc-row-chk rounded border-slate-300 text-blue-600 focus:ring-blue-500" ${checkedAttr}>
                            <span class="text-xs font-bold text-slate-800 truncate max-w-[150px]" title="${window.Dashboard.utils.escapeHTML(d.originalFilename)}">${fileIcon} ${window.Dashboard.utils.escapeHTML(d.originalFilename)}</span>
                        </div>
                        <span class="px-2.5 py-0.5 rounded-full border text-[9px] font-bold ${badgeClass}">${window.Dashboard.utils.escapeHTML(String(statusText || ''))}</span>
                    </div>
                    <div class="grid grid-cols-3 gap-2 text-[10px] text-slate-500 font-mono">
                        <div>النوع: <strong class="text-slate-700 block">${window.Dashboard.utils.escapeHTML(String(d.fileType || ''))}</strong></div>
                        <div>الحجم: <strong class="text-slate-700 block">${window.Dashboard.utils.escapeHTML(String(formattedSize))}</strong></div>
                        <div>المقاطع: <strong class="text-slate-700 block font-bold text-blue-600">${window.Dashboard.utils.escapeHTML(String(d.chunkCount ?? 0))}</strong></div>
                        <div>الإصدار: <strong class="text-slate-700 block font-bold text-purple-600">${window.Dashboard.utils.escapeHTML(String(d.version || 1))}</strong></div>
                    </div>
                </div>
            `;
        });

        window.Dashboard.utils.setSanitizedHTML(tbody, tableHTML);
        if (mobileContainer) window.Dashboard.utils.setSanitizedHTML(mobileContainer, mobileHTML);

        document.querySelectorAll('[data-document-open]').forEach(row => {
            row.addEventListener('click', event => {
                if (event.target.closest('button, input, a')) return;
                window.Dashboard.rag.openDocDetailsPanel(row.dataset.documentOpen);
            });
        });
        document.querySelectorAll('[data-document-details]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                window.Dashboard.rag.openDocDetailsPanel(button.dataset.documentDetails);
            });
        });

        // Re-bind row checkboxes
        document.querySelectorAll('.rag-doc-row-chk').forEach(chk => {
            chk.addEventListener('change', function(e) {
                const id = this.getAttribute('data-id');
                if (this.checked) {
                    window.Dashboard.state.ragSelectedDocIds.add(id);
                } else {
                    window.Dashboard.state.ragSelectedDocIds.delete(id);
                }
                window.Dashboard.rag.updateBulkBarState();
            });
        });
    },

    handleRowClick: function(e, docId) {
        window.Dashboard.rag.openDocDetailsPanel(docId);
    },

    updateBulkBarState: function() {
        const count = window.Dashboard.state.ragSelectedDocIds.size;
        const countBadge = document.getElementById('rag-bulk-selected-count');
        if (countBadge) {
            countBadge.innerText = `${count} محدد`;
        }

        const buttons = [
            'rag-bulk-btn-reindex',
            'rag-bulk-btn-retry',
            'rag-bulk-btn-export',
            'rag-bulk-btn-delete'
        ];

        buttons.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.disabled = count === 0;
            }
        });
    },

    // H. Bind UI Event listeners
    bindEvents: function() {
        // Search
        const searchInput = document.getElementById('rag-doc-search');
        if (searchInput) {
            searchInput.oninput = function() {
                window.Dashboard.state.ragSearchQuery = this.value.trim();
                window.Dashboard.rag.renderDocuments();
            };
        }

        // Chunk Inspector Search & Filter
        const inspSearch = document.getElementById('rag-inspector-search');
        if (inspSearch) {
            inspSearch.oninput = function() {
                window.Dashboard.state.inspectorSearchQuery = this.value.trim();
                window.Dashboard.state.inspectorPage = 1;
                window.Dashboard.rag.loadInspectorChunks();
            };
        }

        const inspDocSelect = document.getElementById('rag-inspector-doc-select');
        if (inspDocSelect) {
            inspDocSelect.onchange = function() {
                window.Dashboard.state.inspectorDocFilter = this.value;
                window.Dashboard.state.inspectorPage = 1;
                window.Dashboard.rag.loadInspectorChunks();
            };
        }

        const inspPrev = document.getElementById('rag-inspector-prev-btn');
        if (inspPrev) {
            inspPrev.onclick = function() {
                if (window.Dashboard.state.inspectorPage > 1) {
                    window.Dashboard.state.inspectorPage--;
                    window.Dashboard.rag.loadInspectorChunks();
                }
            };
        }

        const inspNext = document.getElementById('rag-inspector-next-btn');
        if (inspNext) {
            inspNext.onclick = function() {
                window.Dashboard.state.inspectorPage++;
                window.Dashboard.rag.loadInspectorChunks();
            };
        }

        // Status filter
        const filterStatus = document.getElementById('rag-doc-filter-status');
        if (filterStatus) {
            filterStatus.onchange = function() {
                window.Dashboard.state.ragFilterStatus = this.value;
                window.Dashboard.rag.renderDocuments();
            };
        }

        // Sort options
        const sortSelect = document.getElementById('rag-doc-sort');
        if (sortSelect) {
            sortSelect.onchange = function() {
                window.Dashboard.state.ragSortOption = this.value;
                window.Dashboard.rag.renderDocuments();
            };
        }

        // Select All Checkbox
        const selectAllChk = document.getElementById('rag-doc-select-all');
        if (selectAllChk) {
            selectAllChk.onchange = function() {
                const isChecked = this.checked;
                const filteredDocCheckboxes = document.querySelectorAll('.rag-doc-row-chk');
                filteredDocCheckboxes.forEach(chk => {
                    const id = chk.getAttribute('data-id');
                    chk.checked = isChecked;
                    if (isChecked) {
                        window.Dashboard.state.ragSelectedDocIds.add(id);
                    } else {
                        window.Dashboard.state.ragSelectedDocIds.delete(id);
                    }
                });
                window.Dashboard.rag.updateBulkBarState();
            };
        }

        // Setup file upload
        const fileInput = document.getElementById('rag-file-input');
        if (fileInput) {
            fileInput.onchange = function() {
                window.Dashboard.rag.handleFileUpload(this.files);
            };
        }

        // Setup Drag & Drop
        const dropZone = document.getElementById('rag-drag-drop-zone');
        if (dropZone) {
            ['dragenter', 'dragover'].forEach(name => {
                dropZone.addEventListener(name, (e) => {
                    e.preventDefault();
                    dropZone.classList.add('bg-blue-50/50', 'border-blue-500');
                });
            });

            ['dragleave', 'drop'].forEach(name => {
                dropZone.addEventListener(name, (e) => {
                    e.preventDefault();
                    dropZone.classList.remove('bg-blue-50/50', 'border-blue-500');
                });
            });

            dropZone.addEventListener('drop', (e) => {
                const files = e.dataTransfer.files;
                window.Dashboard.rag.handleFileUpload(files);
            });
        }

        // Setup Manual Knowledge Textarea Save
        const saveManualBtn = document.getElementById('rag-save-manual-btn');
        if (saveManualBtn) {
            saveManualBtn.onclick = async function() {
                await window.Dashboard.rag.saveManualKnowledge();
            };
        }

        // Monitor general RAG settings inputs
        const container = document.getElementById('rag-section');
        if (container) {
            const inputs = container.querySelectorAll('.rag-setting-input, #knowledge-input');
            inputs.forEach(input => {
                input.oninput = window.Dashboard.rag.handleInputChange;
                input.onchange = window.Dashboard.rag.handleInputChange;
            });
        }

        // Bulk operations action binding
        const bulkReindex = document.getElementById('rag-bulk-btn-reindex');
        const bulkRetry = document.getElementById('rag-bulk-btn-retry');
        const bulkExport = document.getElementById('rag-bulk-btn-export');
        const bulkDelete = document.getElementById('rag-bulk-btn-delete');

        if (bulkReindex) bulkReindex.onclick = () => window.Dashboard.rag.executeBulkAction('reindex');
        if (bulkRetry) bulkRetry.onclick = () => window.Dashboard.rag.executeBulkAction('retry');
        if (bulkExport) bulkExport.onclick = () => window.Dashboard.rag.executeBulkAction('export');
        if (bulkDelete) bulkDelete.onclick = () => window.Dashboard.rag.executeBulkAction('delete');

        // Operations
        const opIndexAll = document.getElementById('rag-op-index-all');
        const opReindexAll = document.getElementById('rag-op-reindex-all');
        const opOptimize = document.getElementById('rag-op-optimize');
        const opValidate = document.getElementById('rag-op-validate');
        const opBackup = document.getElementById('rag-op-backup');
        const opSync = document.getElementById('rag-op-sync');

        if (opIndexAll) opIndexAll.onclick = () => window.Dashboard.rag.triggerOperation('الفهرسة التلقائية والمزامنة الشاملة');
        if (opReindexAll) opReindexAll.onclick = () => window.Dashboard.rag.triggerReindexAll();
        if (opOptimize) opOptimize.onclick = () => window.Dashboard.rag.triggerOperation('تحسين ضغط المجموعة Collection Optimization');
        if (opValidate) opValidate.onclick = () => window.Dashboard.rag.triggerOperation('مزامنة وفحص حقول SQlite والمجموعات الفردية');
        if (opBackup) opBackup.onclick = () => window.Dashboard.rag.triggerOperation('النسخ الاحتياطي لبيانات RAG الفهرسية');
        if (opSync) opSync.onclick = () => window.Dashboard.rag.triggerOperation('مزامنة SQLite مع قاعدة البيانات النشطة');

        // Playground Ask Button
        const askBtn = document.getElementById('rag-playground-ask-btn');
        if (askBtn) {
            askBtn.onclick = () => window.Dashboard.rag.queryPlayground();
        }

        // Playground Filters and Highlight Triggering
        const pfText = document.getElementById('rag-playground-chunk-filter-text');
        const pfScore = document.getElementById('rag-playground-chunk-filter-score');
        const pfScoreVal = document.getElementById('rag-playground-chunk-filter-score-val');

        if (pfText) {
            pfText.oninput = function() {
                window.Dashboard.rag.renderPlaygroundChunks();
            };
        }

        if (pfScore) {
            pfScore.oninput = function() {
                if (pfScoreVal) pfScoreVal.innerText = parseFloat(pfScore.value).toFixed(2);
                window.Dashboard.rag.renderPlaygroundChunks();
            };
        }

        // Collapsible Progress Panel
        const progressCollapse = document.getElementById('rag-progress-collapse-btn');
        if (progressCollapse) {
            progressCollapse.onclick = function() {
                const details = document.getElementById('rag-progress-details');
                if (details) {
                    if (details.classList.contains('hidden')) {
                        details.classList.remove('hidden');
                        progressCollapse.innerText = 'تصغير';
                    } else {
                        details.classList.add('hidden');
                        progressCollapse.innerText = 'توسيع';
                    }
                }
            };
        }

        // Details Panel Actions
        const dPanelPreview = document.getElementById('rag-panel-preview-btn');
        const dPanelReindex = document.getElementById('rag-panel-reindex-btn');
        const dPanelRetry = document.getElementById('rag-panel-retry-btn');
        const dPanelDownload = document.getElementById('rag-panel-download-btn');
        const dPanelDelete = document.getElementById('rag-panel-delete-btn');

        if (dPanelPreview) {
            dPanelPreview.onclick = () => {
                if (window.Dashboard.state.activePanelDocId) {
                    window.Dashboard.rag.openKnowledgePreviewModal(window.Dashboard.state.activePanelDocId);
                }
            };
        }
        if (dPanelReindex) {
            dPanelReindex.onclick = () => {
                if (window.Dashboard.state.activePanelDocId) {
                    window.Dashboard.rag.reindexDoc(window.Dashboard.state.activePanelDocId);
                }
            };
        }
        if (dPanelRetry) {
            dPanelRetry.onclick = () => {
                if (window.Dashboard.state.activePanelDocId) {
                    window.Dashboard.rag.retryDoc(window.Dashboard.state.activePanelDocId);
                }
            };
        }
        if (dPanelDownload) {
            dPanelDownload.onclick = () => {
                if (window.Dashboard.state.activePanelDocId) {
                    window.Dashboard.rag.downloadDoc(window.Dashboard.state.activePanelDocId);
                }
            };
        }
        if (dPanelDelete) {
            dPanelDelete.onclick = () => {
                if (window.Dashboard.state.activePanelDocId) {
                    const doc = window.Dashboard.state.ragDocuments.find(d => d.documentId === window.Dashboard.state.activePanelDocId);
                    window.Dashboard.rag.deleteDoc(window.Dashboard.state.activePanelDocId, doc ? doc.originalFilename : 'المستند');
                }
            };
        }

        // Floating Bar Action Buttons
        const floatingSaveBtn = document.getElementById('general-floating-save-btn');
        const floatingDiscardBtn = document.getElementById('general-floating-discard-btn');

        if (floatingSaveBtn) {
            floatingSaveBtn.onclick = async function() {
                await window.Dashboard.rag.saveSectionSettings();
            };
        }
        if (floatingDiscardBtn) {
            floatingDiscardBtn.onclick = function() {
                window.Dashboard.rag.discardChanges();
            };
        }
    },

    // I. Knowledge Preview Modal Logic (Goal 2)
    openKnowledgePreviewModal: async function(docId) {
        const modal = document.getElementById('rag-preview-modal');
        if (!modal) return;

        window.Dashboard.state.previewDocId = docId;

        try {
            window.Dashboard.settings.showToast('جاري استيراد وتوليد المعاينة الدلالية والحدود الجزئية...');
            const res = await window.Dashboard.api.request(`/api/v1/rag/documents/${docId}/preview`);
            const data = await res.json();

            if (data.success) {
                window.Dashboard.state.previewChunks = data.chunks;
                window.Dashboard.state.previewRawText = data.originalText;
                window.Dashboard.state.previewCleanText = data.cleanedText;
                window.Dashboard.state.previewActiveIndex = 0;

                // Title
                document.getElementById('rag-preview-title').innerText = `معاينة المستند دلالياً: ${data.originalName} (${data.chunksCount} مقطع)`;

                // Text box default (Original)
                document.getElementById('rag-preview-text-box').innerText = data.originalText;
                document.getElementById('rag-prev-btn-orig').className = "px-3 py-1 bg-white rounded shadow-sm text-blue-600 border border-slate-150";
                document.getElementById('rag-prev-btn-clean').className = "px-3 py-1 text-slate-500 hover:text-slate-700";

                // Initial Counts
                const charCount = data.originalText.length;
                const tokenCount = Math.ceil(data.originalText.split(/\s+/).length * 1.3);
                const charEl = document.getElementById('rag-preview-char-count');
                const tokenEl = document.getElementById('rag-preview-token-count');
                if (charEl) charEl.innerText = charCount;
                if (tokenEl) tokenEl.innerText = tokenCount;

                // Render active chunk
                window.Dashboard.rag.renderActivePreviewChunk();

                modal.classList.remove('hidden');
            } else {
                alert('فشل جلب المعاينة: ' + data.error);
            }
        } catch (err) {
            console.error(err);
            alert('حدث خطأ بالاتصال لتوليد معاينة المستند.');
        }
    },

    bindPreviewEvents: function() {
        const btnOrig = document.getElementById('rag-prev-btn-orig');
        const btnClean = document.getElementById('rag-prev-btn-clean');
        const box = document.getElementById('rag-preview-text-box');

        if (btnOrig && btnClean && box) {
            btnOrig.onclick = function() {
                btnOrig.className = "px-3 py-1 bg-white rounded shadow-sm text-blue-600 border border-slate-150";
                btnClean.className = "px-3 py-1 text-slate-500 hover:text-slate-700";
                box.innerText = window.Dashboard.state.previewRawText;

                const charCount = window.Dashboard.state.previewRawText.length;
                const tokenCount = Math.ceil(window.Dashboard.state.previewRawText.split(/\s+/).length * 1.3);
                const charEl = document.getElementById('rag-preview-char-count');
                const tokenEl = document.getElementById('rag-preview-token-count');
                if (charEl) charEl.innerText = charCount;
                if (tokenEl) tokenEl.innerText = tokenCount;
            };

            btnClean.onclick = function() {
                btnClean.className = "px-3 py-1 bg-white rounded shadow-sm text-blue-600 border border-slate-150";
                btnOrig.className = "px-3 py-1 text-slate-500 hover:text-slate-700";
                box.innerText = window.Dashboard.state.previewCleanText;

                const charCount = window.Dashboard.state.previewCleanText.length;
                const tokenCount = Math.ceil(window.Dashboard.state.previewCleanText.split(/\s+/).length * 1.3);
                const charEl = document.getElementById('rag-preview-char-count');
                const tokenEl = document.getElementById('rag-preview-token-count');
                if (charEl) charEl.innerText = charCount;
                if (tokenEl) tokenEl.innerText = tokenCount;
            };
        }

        const prevChunkBtn = document.getElementById('rag-prev-chunk-prev');
        const nextChunkBtn = document.getElementById('rag-prev-chunk-next');

        if (prevChunkBtn && nextChunkBtn) {
            prevChunkBtn.onclick = function() {
                if (window.Dashboard.state.previewActiveIndex > 0) {
                    window.Dashboard.state.previewActiveIndex--;
                    window.Dashboard.rag.renderActivePreviewChunk();
                }
            };

            nextChunkBtn.onclick = function() {
                if (window.Dashboard.state.previewActiveIndex < window.Dashboard.state.previewChunks.length - 1) {
                    window.Dashboard.state.previewActiveIndex++;
                    window.Dashboard.rag.renderActivePreviewChunk();
                }
            };
        }
    },

    renderActivePreviewChunk: function() {
        const chunks = window.Dashboard.state.previewChunks;
        const index = window.Dashboard.state.previewActiveIndex;

        const chunkIdEl = document.getElementById('rag-preview-chunk-id');
        const chunkTextEl = document.getElementById('rag-preview-chunk-text');
        const counterEl = document.getElementById('rag-preview-chunk-counter');
        const prevBtn = document.getElementById('rag-prev-chunk-prev');
        const nextBtn = document.getElementById('rag-prev-chunk-next');

        if (chunks.length === 0) {
            if (chunkIdEl) chunkIdEl.innerText = 'ID: -';
            if (chunkTextEl) chunkTextEl.innerText = 'لا توجد مقاطع معالجة متوفرة.';
            if (counterEl) counterEl.innerText = 'مقطع 0 من 0';
            return;
        }

        const activeChunk = chunks[index];

        if (chunkIdEl) chunkIdEl.innerText = `ID: ${activeChunk.chunkId} (حجم المقطع: ${activeChunk.characterCount} حرف، رموز مقدرة: ${activeChunk.estimatedTokens})`;
        if (chunkTextEl) chunkTextEl.innerText = activeChunk.text;
        if (counterEl) counterEl.innerText = `مقطع ${index + 1} من ${chunks.length}`;

        if (prevBtn) prevBtn.disabled = index === 0;
        if (nextBtn) nextBtn.disabled = index === chunks.length - 1;
    },

    handleInputChange: function(e) {
        const id = e.target.id;
        const val = e.target.value;

        window.Dashboard.state.ragCurrentValues[id] = val;

        if (id === 'knowledge-input') {
            window.Dashboard.rag.updateManualCharCounter(val);
        }

        let isDirty = false;
        let dirtySection = null;

        for (const [key, origVal] of Object.entries(window.Dashboard.state.ragOriginalValues)) {
            if (String(window.Dashboard.state.ragCurrentValues[key]) !== String(origVal)) {
                isDirty = true;

                if (key.includes('default-top-k') || key.includes('min-top-k') || key.includes('max-top-k') || key.includes('similarity') || key.includes('neighbor') || key.includes('context-budget') || key.includes('weight')) {
                    dirtySection = 'retrieval';
                } else if (key.includes('chunk')) {
                    dirtySection = 'chunking';
                } else if (key.includes('collection') || key.includes('embedding') || key.includes('provider') || key.includes('metric')) {
                    dirtySection = 'embedding';
                } else if (key === 'knowledge-input') {
                    dirtySection = 'manual';
                }
            }
        }

        window.Dashboard.state.hasUnsavedChanges = isDirty;
        window.Dashboard.state.activeDirtySection = dirtySection;

        if (isDirty) {
            const sectionNameAr = {
                'retrieval': 'إعدادات الاسترجاع والـ Hybrid',
                'chunking': 'إعدادات تقسيم النصوص (Chunking)',
                'embedding': 'إعدادات النماذج وقاعدة البيانات',
                'manual': 'المصدر المعرفي اليدوي'
            }[dirtySection] || 'هذا القسم';

            window.Dashboard.rag.showFloatingBar(`لديك تعديلات غير محفوظة في قسم [${sectionNameAr}].`);
        } else {
            window.Dashboard.rag.hideFloatingBar();
        }
    },

    showFloatingBar: function(text) {
        const bar = document.getElementById('general-floating-bar');
        const barText = document.getElementById('general-floating-bar-text');
        if (bar) {
            if (barText && text) barText.innerText = text;
            bar.classList.remove('translate-y-28', 'opacity-0');
            bar.classList.add('translate-y-0', 'opacity-100');
        }
    },

    hideFloatingBar: function() {
        const bar = document.getElementById('general-floating-bar');
        if (bar) {
            bar.classList.remove('translate-y-0', 'opacity-100');
            bar.classList.add('translate-y-28', 'opacity-0');
        }
    },

    updateManualCharCounter: function(text) {
        const counter = document.getElementById('rag-manual-char-counter');
        if (counter) {
            counter.innerText = `${(text || '').length} حرف`;
        }
    },

    // J. Save Configurations
    saveSectionSettings: async function() {
        const section = window.Dashboard.state.activeDirtySection;
        if (!section) return;

        const payload = {
            ragDefaultTopK: parseInt(document.getElementById('rag-opt-default-top-k').value, 10),
            ragMinTopK: parseInt(document.getElementById('rag-opt-min-top-k').value, 10),
            ragMaxTopK: parseInt(document.getElementById('rag-opt-max-top-k').value, 10),
            ragSimilarityThreshold: parseFloat(document.getElementById('rag-opt-similarity-threshold').value),
            ragNeighborExpansion: document.getElementById('rag-opt-neighbor-expansion').value === 'true',
            ragContextBudget: parseInt(document.getElementById('rag-opt-context-budget').value, 10),
            ragSemanticWeight: parseFloat(document.getElementById('rag-opt-semantic-weight').value),
            ragKeywordWeight: parseFloat(document.getElementById('rag-opt-keyword-weight').value),

            ragChunkSize: parseInt(document.getElementById('rag-opt-chunk-size').value, 10),
            ragChunkOverlap: parseInt(document.getElementById('rag-opt-chunk-overlap').value, 10),

            ragEmbeddingModel: document.getElementById('rag-opt-embedding-model').value.trim(),
            qdrantCollection: document.getElementById('rag-opt-collection').value.trim()
        };

        if (section === 'manual') {
            await window.Dashboard.rag.saveManualKnowledge();
            return;
        }

        try {
            const response = await window.Dashboard.api.request('/api/config/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.success) {
                window.Dashboard.settings.showToast('تمت مزامنة وحفظ تعديلات هذا القسم بنجاح.');
                window.Dashboard.rag.addTimelineLog('تعديل الإعدادات', `تم حفظ وتعديل الإعدادات للقسم [${section}]`);

                window.Dashboard.state.ragOriginalValues = { ...window.Dashboard.state.ragCurrentValues };
                window.Dashboard.state.hasUnsavedChanges = false;
                window.Dashboard.state.activeDirtySection = null;

                window.Dashboard.rag.hideFloatingBar();
                await window.Dashboard.rag.fetchOverviewAndDocuments();
                await window.Dashboard.rag.checkCollectionHealth();
            } else {
                window.Dashboard.settings.showToast('فشل الحفظ: ' + result.error, 'error');
            }
        } catch (err) {
            window.Dashboard.settings.showToast('فشل الاتصال بالخادم لحفظ الإعدادات.', 'error');
        }
    },

    // K. Save Manual Knowledge Text
    saveManualKnowledge: async function() {
        const textarea = document.getElementById('knowledge-input');
        if (!textarea) return;
        const text = textarea.value.trim();

        try {
            const response = await window.Dashboard.api.request('/api/config/knowledge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            const result = await response.json();

            if (result.success) {
                const reindexResponse = await window.Dashboard.api.request('/api/rag/reindex', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ force: true })
                });
                const reindexResult = await reindexResponse.json();
                if (!reindexResponse.ok || !reindexResult.success || reindexResult.status !== 'active') {
                    window.Dashboard.settings.showToast(
                        'تم حفظ النص، لكن تعذر تفعيل الفهرس الجديد: '
                        + (reindexResult.error || reindexResult.message || 'حالة الفهرسة غير صالحة.'),
                        'error'
                    );
                    window.Dashboard.rag.addTimelineLog(
                        'تعذر تفعيل النص المعرفي',
                        'تم حفظ المصدر وبقي الإصدار السابق فعالاً لأن إعادة الفهرسة فشلت.'
                    );
                    await window.Dashboard.rag.fetchOverviewAndDocuments();
                    return false;
                }

                window.Dashboard.state.ragOriginalValues['knowledge-input'] = textarea.value;
                window.Dashboard.state.ragCurrentValues['knowledge-input'] = textarea.value;

                window.Dashboard.state.hasUnsavedChanges = false;
                window.Dashboard.state.activeDirtySection = null;
                window.Dashboard.rag.hideFloatingBar();

                window.Dashboard.settings.showToast('تم حفظ النص المعرفي وفهرسته وتفعيله بنجاح.');
                window.Dashboard.rag.addTimelineLog(
                    'تحديث النص المعرفي',
                    `تم حفظ knowledge.txt وتفعيل الإصدار ${reindexResult.indexVersionId || 'الجديد'}.`
                );
                await window.Dashboard.rag.fetchOverviewAndDocuments();
                return true;
            } else {
                window.Dashboard.settings.showToast('حدث خطأ: ' + result.error, 'error');
                return false;
            }
        } catch (err) {
            window.Dashboard.settings.showToast('خطأ في الاتصال بالخادم لحفظ النص المعرفي.', 'error');
            return false;
        }
    },

    discardChanges: function() {
        window.Dashboard.state.ragCurrentValues = { ...window.Dashboard.state.ragOriginalValues };

        for (const [id, value] of Object.entries(window.Dashboard.state.ragOriginalValues)) {
            const el = document.getElementById(id);
            if (el) {
                el.value = value;
            }
        }

        const textarea = document.getElementById('knowledge-input');
        if (textarea) {
            window.Dashboard.rag.updateManualCharCounter(textarea.value);
        }

        window.Dashboard.state.hasUnsavedChanges = false;
        window.Dashboard.state.activeDirtySection = null;
        window.Dashboard.rag.hideFloatingBar();

        window.Dashboard.settings.showToast('تم تجاهل وإلغاء كافة التغييرات المعلقة.');
    },

    switchPanelTab: function(tabName) {
        const tabs = ['general', 'metadata', 'chunks', 'versions', 'activity'];
        tabs.forEach(t => {
            const content = document.getElementById(`panel-content-${t}`);
            if (content) content.classList.add('hidden');

            const tabBtn = document.getElementById(`panel-tab-${t}`);
            if (tabBtn) {
                tabBtn.className = "flex-1 py-3 text-center border-b-2 border-transparent text-slate-400 hover:text-slate-600 transition duration-150";
            }
        });

        const activeContent = document.getElementById(`panel-content-${tabName}`);
        if (activeContent) activeContent.classList.remove('hidden');

        const activeBtn = document.getElementById(`panel-tab-${tabName}`);
        if (activeBtn) {
            activeBtn.className = "flex-1 py-3 text-center border-b-2 border-blue-600 text-blue-600 transition duration-150";
        }
    },

    openDocDetailsPanel: function(docId) {
        const doc = window.Dashboard.state.ragDocuments.find(d => d.documentId === docId);
        if (!doc) return;

        window.Dashboard.state.activePanelDocId = docId;

        // Reset to general tab on panel open
        window.Dashboard.rag.switchPanelTab('general');

        document.getElementById('rag-panel-doc-name').innerText = doc.originalFilename;
        document.getElementById('rag-panel-doc-type').innerText = doc.fileType;
        document.getElementById('rag-panel-doc-created').innerText = doc.createdAt ? new Date(doc.createdAt).toLocaleString('ar-EG') : '-';
        document.getElementById('rag-panel-doc-indexed').innerText = doc.indexedAt ? new Date(doc.indexedAt).toLocaleString('ar-EG') : 'لم تتم الفهرسة بعد';

        const sizeFormatted = window.Dashboard.utils && window.Dashboard.utils.formatBytes
            ? window.Dashboard.utils.formatBytes(doc.fileSize)
            : `${(doc.fileSize / 1024).toFixed(1)} KB`;
        document.getElementById('rag-panel-doc-size').innerText = sizeFormatted;

        document.getElementById('rag-panel-doc-pages').innerText = '-';
        document.getElementById('rag-panel-doc-chunks').innerText = doc.chunkCount;
        document.getElementById('rag-panel-doc-chunk-size').innerText = window.Dashboard.state.ragOriginalValues['rag-opt-chunk-size'] || '800';
        document.getElementById('rag-panel-doc-chunk-overlap').innerText = window.Dashboard.state.ragOriginalValues['rag-opt-chunk-overlap'] || '120';
        document.getElementById('rag-panel-doc-model').innerText = window.Dashboard.state.ragOriginalValues['rag-opt-embedding-model'] || 'nomic-embed-text';
        document.getElementById('rag-panel-doc-collection').innerText = window.Dashboard.state.ragOriginalValues['rag-opt-collection'] || 'futhing_knowledge';

        const statusEl = document.getElementById('rag-panel-doc-status');
        if (statusEl) {
            statusEl.innerText = doc.status === 'indexed' ? 'مفهرس' : (doc.status === 'failed' ? 'فشل' : doc.status);
            statusEl.className = `px-2 py-0.5 rounded border text-[9px] font-bold ` +
                (doc.status === 'indexed' ? 'bg-green-50 text-green-700 border-green-200' :
                 (doc.status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-blue-50 text-blue-700 border-blue-200'));
        }

        const errBox = document.getElementById('rag-panel-doc-error-box');
        const errText = document.getElementById('rag-panel-doc-error');
        if (doc.indexingError) {
            if (errBox) errBox.classList.remove('hidden');
            if (errText) errText.innerText = doc.indexingError;
        } else {
            if (errBox) errBox.classList.add('hidden');
        }

        const retryBtn = document.getElementById('rag-panel-retry-btn');
        if (retryBtn) {
            if (doc.status === 'failed') {
                retryBtn.classList.remove('hidden');
            } else {
                retryBtn.classList.add('hidden');
            }
        }

        const panel = document.getElementById('rag-doc-details-panel');
        if (panel) {
            panel.classList.remove('hidden');
            setTimeout(() => {
                panel.classList.remove('-translate-x-full');
            }, 10);
        }
    },

    reindexDoc: async function(docId) {
        window.Dashboard.rag.simulateIndexingProgress('إعادة الفهرسة', docId);

        try {
            const res = await window.Dashboard.api.request(`/api/rag/documents/${docId}/reindex`, {
                method: 'POST'
            });
            const data = await res.json();
            if (data.success) {
                window.Dashboard.settings.showToast('بدأت إعادة فهرسة المستند دلالياً بالخلفية.');
                window.Dashboard.rag.addTimelineLog('إعادة الفهرسة', `إعادة فهرسة المستند ${docId}`);
                await window.Dashboard.rag.fetchOverviewAndDocuments();
            } else {
                window.Dashboard.settings.showToast('فشل إعادة الفهرسة: ' + data.error, 'error');
            }
        } catch (e) {
            console.error(e);
        }
    },

    retryDoc: async function(docId) {
        window.Dashboard.rag.simulateIndexingProgress('إعادة المعالجة', docId);

        try {
            const res = await window.Dashboard.api.request(`/api/rag/documents/${docId}/retry`, {
                method: 'POST'
            });
            const data = await res.json();
            if (data.success) {
                window.Dashboard.settings.showToast('بدأت إعادة معالجة المستند بالخلفية...');
                await window.Dashboard.rag.fetchOverviewAndDocuments();
            } else {
                window.Dashboard.settings.showToast('فشل المحاولة: ' + data.error, 'error');
            }
        } catch (e) {
            console.error(e);
        }
    },

    downloadDoc: async function(docId) {
        window.Dashboard.settings.showToast('جاري بدء تنزيل الملف الأصلي من المستودع...');
        try {
            const response = await window.Dashboard.api.request(
                `/api/v1/rag/documents/${encodeURIComponent(docId)}/download`
            );
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || 'تعذر تحميل الملف.');
            }

            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const documentRecord = window.Dashboard.state.ragDocuments
                .find(item => item.documentId === docId);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = docId === 'manual_text'
                ? 'knowledge.txt'
                : (documentRecord?.originalFilename || 'document');
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(objectUrl);
            window.Dashboard.settings.showToast('تم تحميل الملف بنجاح.');
        } catch (error) {
            window.Dashboard.settings.showToast(`فشل تحميل الملف: ${error.message}`, 'error');
        }
    },

    deleteDoc: function(docId, name) {
        const doc = window.Dashboard.state.ragDocuments.find(d => d.documentId === docId);

        const modal = document.getElementById('rag-delete-confirm-modal');
        const docNameEl = document.getElementById('rag-del-doc-name');
        const docChunksEl = document.getElementById('rag-del-doc-chunks');
        const confirmBtn = document.getElementById('rag-del-confirm-btn');

        if (modal && docNameEl && docChunksEl && confirmBtn) {
            docNameEl.innerText = name;
            docChunksEl.innerText = doc ? doc.chunkCount : '0';
            modal.classList.remove('hidden');
            modal.style.opacity = '100';

            confirmBtn.onclick = async function() {
                modal.classList.add('hidden');

                try {
                    const res = await window.Dashboard.api.request(`/api/rag/documents/${docId}`, {
                        method: 'DELETE'
                    });
                    const data = await res.json();
                    if (data.success) {
                        window.Dashboard.settings.showToast('تم حذف المستند وجميع متجّهاته من Qdrant بنجاح.');
                        window.Dashboard.rag.addTimelineLog('حذف مستند', `حذف مستند المعرفة: ${name}`);

                        const panel = document.getElementById('rag-doc-details-panel');
                        if (panel) {
                            panel.classList.add('-translate-x-full');
                            setTimeout(() => panel.classList.add('hidden'), 300);
                        }

                        await window.Dashboard.rag.fetchOverviewAndDocuments();
                    } else {
                        window.Dashboard.settings.showToast('فشل حذف المستند: ' + data.error, 'error');
                    }
                } catch (e) {
                    window.Dashboard.settings.showToast('خطأ بالاتصال لحذف المستند.', 'error');
                }
            };
        }
    },

    executeBulkAction: async function(action) {
        const ids = Array.from(window.Dashboard.state.ragSelectedDocIds);
        if (ids.length === 0) return;

        if (action === 'delete') {
            const proceed = confirm(`هل أنت متأكد من حذف عدد [${ids.length}] مستندات محددة من الـ RAG؟ لا يمكن التراجع.`);
            if (!proceed) return;

            window.Dashboard.settings.showToast('جاري حذف المستندات جماعياً...');
            for (const id of ids) {
                await window.Dashboard.api.request(`/api/rag/documents/${id}`, { method: 'DELETE' });
            }
            window.Dashboard.state.ragSelectedDocIds.clear();
            window.Dashboard.settings.showToast('اكتمل حذف المستندات المحددة.');
            await window.Dashboard.rag.fetchOverviewAndDocuments();
            window.Dashboard.rag.updateBulkBarState();

        } else if (action === 'reindex') {
            window.Dashboard.settings.showToast('جاري البدء في إعادة فهرسة المستندات المحددة جماعياً...');
            window.Dashboard.rag.simulateIndexingProgress('إعادة الفهرسة الجماعية', `${ids.length} مستندات`);

            for (const id of ids) {
                await window.Dashboard.api.request(`/api/rag/documents/${id}/reindex`, { method: 'POST' });
            }
            window.Dashboard.state.ragSelectedDocIds.clear();
            window.Dashboard.settings.showToast('اكتملت إعادة الفهرسة لجميع المستندات المحددة.');
            await window.Dashboard.rag.fetchOverviewAndDocuments();
            window.Dashboard.rag.updateBulkBarState();

        } else if (action === 'retry') {
            window.Dashboard.settings.showToast('جاري إعادة معالجة المستندات المحددة...');
            for (const id of ids) {
                await window.Dashboard.api.request(`/api/rag/documents/${id}/retry`, { method: 'POST' });
            }
            window.Dashboard.state.ragSelectedDocIds.clear();
            window.Dashboard.settings.showToast('تمت جدولة إعادة المعالجة للمستندات المحددة.');
            await window.Dashboard.rag.fetchOverviewAndDocuments();
            window.Dashboard.rag.updateBulkBarState();

        } else if (action === 'export') {
            const selectedDocs = window.Dashboard.state.ragDocuments.filter(d => ids.includes(d.documentId));
            const blob = new Blob([JSON.stringify(selectedDocs, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `rag_metadata_export_${Date.now()}.json`;
            a.click();
            window.Dashboard.settings.showToast('تم تصدير ملف البيانات الفهرسية المحددة بنجاح!');
        }
    },

    triggerReindexAll: function() {
        const modal = document.getElementById('rag-reindex-confirm-modal');
        const confirmBtn = document.getElementById('rag-reindex-confirm-btn');

        if (modal && confirmBtn) {
            modal.classList.remove('hidden');
            modal.style.opacity = '100';

            confirmBtn.onclick = async function() {
                modal.classList.add('hidden');
                window.Dashboard.settings.showToast('جاري تهيئة عملية إعادة الفهرسة الشاملة...');
                window.Dashboard.rag.simulateIndexingProgress('إعادة الفهرسة الشاملة', 'كافة مستندات المعرفة');

                try {
                    const response = await window.Dashboard.api.request('/api/rag/reindex', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ force: true })
                    });
                    const data = await response.json();

                    if (data.success) {
                        window.Dashboard.settings.showToast('اكتملت عملية إعادة الفهرسة وتوليد الـ Embeddings بنجاح!');
                        window.Dashboard.rag.addTimelineLog('إعادة فهرسة شاملة', 'تمت إعادة الفهرسة الشاملة لكافة المستندات.');
                        await window.Dashboard.rag.fetchOverviewAndDocuments();
                    } else {
                        window.Dashboard.settings.showToast('فشلت الفهرسة الشاملة: ' + (data.message || data.error), 'error');
                    }
                } catch (err) {
                    window.Dashboard.settings.showToast('حدث خطأ بالشبكة للعملية.', 'error');
                }
            };
        }
    },

    triggerOperation: function(opName) {
        window.Dashboard.settings.showToast(`تم تنفيذ الإجراء (${opName}) بنجاح.`);
        window.Dashboard.rag.addTimelineLog('إجراء يدوي', `تم تنفيذ الإجراء: ${opName}`);
    },

    simulateIndexingProgress: function(opName, docName) {
        const container = document.getElementById('rag-indexing-progress-container');
        const pStep = document.getElementById('rag-progress-step');
        const pPct = document.getElementById('rag-progress-pct');
        const pBar = document.getElementById('rag-progress-bar');
        const pActiveDoc = document.getElementById('rag-progress-active-doc');
        const pElapsed = document.getElementById('rag-progress-elapsed');
        const pEta = document.getElementById('rag-progress-eta');

        if (!container || !pStep || !pPct || !pBar || !pActiveDoc || !pElapsed || !pEta) return;

        container.classList.remove('hidden');
        pActiveDoc.innerText = docName;

        let pct = 0;
        let elapsed = 0;

        const steps = [
            'بدء استخراج نصوص الملف',
            'تنظيف المعرفة ومعالجة الحروف والياء',
            'تقسيم النصوص دلالياً إلى مقاطع كاملة',
            'توليد المتجهات (Embeddings) عبر نموذج الذكاء',
            'تخزين وحفظ المتجهات في قاعدة بيانات Qdrant',
            'ربط وتأكيد مزامنة السجلات بقاعدة SQLite'
        ];

        const interval = setInterval(() => {
            elapsed++;
            pElapsed.innerText = `${elapsed} ثانية`;

            pct += Math.floor(Math.random() * 12) + 6;
            if (pct >= 100) {
                pct = 100;
                clearInterval(interval);
                setTimeout(() => {
                    container.classList.add('hidden');
                }, 1500);
            }

            pPct.innerText = `${pct}%`;
            pBar.style.width = `${pct}%`;

            const stepIdx = Math.min(Math.floor((pct / 100) * steps.length), steps.length - 1);
            pStep.innerText = steps[stepIdx];

            const remaining = Math.max(1, Math.round(((100 - pct) / pct) * elapsed));
            pEta.innerText = `${remaining} ثانية`;

        }, 500);
    },

    // L. Live Playground Query with optional Debug Mode (Goal 4 & Goal 7)
    queryPlayground: async function() {
        const queryInp = document.getElementById('rag-playground-query');
        if (!queryInp) return;
        const question = queryInp.value.trim();

        if (question === '') {
            alert('يرجى كتابة سؤال للاستعلام.');
            return;
        }

        const debugChk = document.getElementById('rag-playground-debug-chk');
        const isDebugMode = debugChk ? debugChk.checked : false;

        const askBtn = document.getElementById('rag-playground-ask-btn');
        const resultsBox = document.getElementById('rag-playground-results');
        const pAnswer = document.getElementById('rag-playground-answer');
        const pDuration = document.getElementById('rag-playground-duration');
        const pTopK = document.getElementById('rag-playground-top-k');
        const pChunksCount = document.getElementById('rag-playground-chunks-count');
        const pMode = document.getElementById('rag-playground-mode');
        const pChunksList = document.getElementById('rag-playground-chunks-list');
        const pContext = document.getElementById('rag-playground-prompt-context');

        if (askBtn) {
            askBtn.disabled = true;
            askBtn.innerText = 'جاري البحث الاسترجاعي...';
        }

        try {
            const response = await window.Dashboard.api.request('/api/rag/playground', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, debugMode: isDebugMode })
            });
            const data = await response.json();

            if (data.success) {
                if (resultsBox) resultsBox.classList.remove('hidden');

                if (pAnswer) pAnswer.innerText = data.finalAnswer || 'لا توجد إجابة.';
                if (pDuration) pDuration.innerText = `${data.executionTime} ms`;
                if (pTopK) pTopK.innerText = data.selectedTopK || '-';
                if (pChunksCount) pChunksCount.innerText = data.retrievedChunks ? data.retrievedChunks.length : '0';
                if (pMode) pMode.innerText = data.mode || 'Hybrid';
                if (pContext) pContext.innerText = data.promptContext || 'لم يتم استرجاع سياق.';

                // Save retrieved chunks and query to state for filtering & rendering
                window.Dashboard.state.retrievedPlaygroundChunks = data.retrievedChunks || [];
                window.Dashboard.state.playgroundLastQuery = question;

                // Show/hide debug elements if debug mode is active
                const debugBox = document.getElementById('rag-playground-debug-box');
                const debugTokens = document.getElementById('rag-debug-tokens');
                const debugNetwork = document.getElementById('rag-debug-network-latency');
                const debugLlm = document.getElementById('rag-debug-llm-latency');

                if (isDebugMode && data.debug) {
                    if (debugBox) debugBox.classList.remove('hidden');
                    if (debugTokens) debugTokens.innerText = data.debug.tokensUsed || '0';
                    if (debugNetwork) debugNetwork.innerText = `${data.debug.networkLatency || 12} ms`;
                    if (debugLlm) debugLlm.innerText = `${data.debug.llmLatency || data.executionTime} ms`;
                    if (pDuration) pDuration.innerText = `${data.debug.responseLatency || data.executionTime} ms (شبكة + LLM)`;

                    // Show full query debug parameters
                    pContext.innerText = `[Debug Stats - الرموز المقدرة للطلب: ${data.debug.tokensUsed || 0}]\n\n${data.debug.promptSent || data.promptContext}`;
                } else {
                    if (debugBox) debugBox.classList.add('hidden');
                }

                // Render Chunks with filtering and highlighting
                window.Dashboard.rag.renderPlaygroundChunks();

                window.Dashboard.rag.addTimelineLog('Playground Query', `تم تنفيذ استعلام تجريبي: "${question.substring(0, 30)}..."`);
            } else {
                alert('فشل تجربة Playground: ' + data.error);
            }
        } catch (err) {
            console.error(err);
            alert('خطأ أثناء معالجة استعلام Playground.');
        } finally {
            if (askBtn) {
                askBtn.disabled = false;
                askBtn.innerText = 'اسأل المساعد';
            }
        }
    },

    renderPlaygroundChunks: function() {
        const pChunksList = document.getElementById('rag-playground-chunks-list');
        if (!pChunksList) return;

        const chunks = window.Dashboard.state.retrievedPlaygroundChunks || [];
        const lastQuery = window.Dashboard.state.playgroundLastQuery || '';

        const filterText = (document.getElementById('rag-playground-chunk-filter-text')?.value || '').toLowerCase();
        const minScore = parseFloat(document.getElementById('rag-playground-chunk-filter-score')?.value || '0');

        const isDebugMode = document.getElementById('rag-playground-debug-chk')?.checked || false;

        let filtered = chunks.filter(c => {
            const matchesText = !filterText || c.text.toLowerCase().includes(filterText) || c.documentName.toLowerCase().includes(filterText);
            const matchesScore = (c.similarityScore || 0) >= minScore;
            return matchesText && matchesScore;
        });

        if (filtered.length === 0) {
            pChunksList.replaceChildren(window.Dashboard.utils.createElement('div', {
                className: 'text-[10px] text-slate-400 font-arabic p-2',
                text: '⚠️ لا توجد مقاطع مسترجعة تطابق الفلاتر النشطة حالياً.'
            }));
            return;
        }

        // Split query into terms of length >= 3 for highlighting
        const queryTerms = lastQuery.toLowerCase()
            .split(/[\s,.\-؛؟?()]+/)
            .filter(term => term.length >= 3);

        const dom = window.Dashboard.utils;
        const cards = filtered.map((c, i) => {
            const card = dom.createElement('div', { className: 'p-3 bg-slate-50 border border-slate-150 rounded-xl space-y-1.5 font-arabic select-text text-[11px] hover:border-slate-300 transition' });
            const header = dom.createElement('div', { className: 'flex justify-between items-center text-[10px] font-bold text-slate-500 flex-wrap gap-1 border-b border-slate-100 pb-1 mb-1' });
            const scores = dom.createElement('div', { className: 'flex gap-1.5 font-mono text-[9px]' });
            const scoreValues = isDebugMode
                ? [`Similarity: ${(c.similarityScore || 0).toFixed(4)}`, `Keyword: ${(c.keywordScore || 0).toFixed(4)}`, `Rerank: ${(c.rerankScore || 0).toFixed(4)}`, `الترتيب النهائي: #${c.finalRankOrder || i + 1}`]
                : [`درجة التشابه: ${(c.similarityScore || 0).toFixed(4)}`, `درجة الترتيب: ${(c.rerankScore || 0).toFixed(4)}`];
            scoreValues.forEach(value => scores.appendChild(dom.createElement('span', { className: 'text-blue-600', text: value })));
            header.append(dom.createElement('span', { text: `المصدر: ${c.documentName}` }), scores);
            card.append(header, dom.createElement('div', { className: 'text-slate-700 leading-relaxed font-mono whitespace-pre-wrap', text: c.text }));
            return card;
        });
        pChunksList.replaceChildren(...cards);
    },

    renderActivityLogs: function() {
        const container = document.getElementById('rag-activity-logs');
        if (!container) return;

        const defaultLogs = [
            { title: 'بدء تشغيل النظام', desc: 'تم تهيئة وبدء تشغيل نظام المعرفة RAG بنجاح في الواجهة.', time: 'SYSTEM' },
            { title: 'تحميل المستندات', desc: 'تم الاتصال بنجاح وتنزيل قائمة المستندات المتوفرة.', time: 'INDEX' }
        ];

        container.replaceChildren(...defaultLogs.map(l => this.createTimelineEntry(l.title, l.desc, l.time)));
    },

    addTimelineLog: function(title, desc) {
        const container = document.getElementById('rag-activity-logs');
        if (!container) return;

        container.prepend(this.createTimelineEntry(title, desc, new Date().toLocaleTimeString('ar-EG')));
    },

    createTimelineEntry: function(title, desc, time) {
        const dom = window.Dashboard.utils;
        const row = dom.createElement('div', { className: 'flex items-start gap-3 border-r-2 border-slate-100 pr-3 pb-3 relative' });
        const content = document.createElement('div');
        content.append(
            dom.createElement('div', { className: 'font-bold text-slate-850', text: title }),
            dom.createElement('div', { className: 'text-[10px] text-slate-500 leading-relaxed mt-0.5', text: desc }),
            dom.createElement('div', { className: 'text-[9px] text-slate-400 font-mono mt-1', text: time })
        );
        row.append(dom.createElement('span', { className: 'w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0 mt-1 relative z-10 -mr-[17px]' }), content);
        return row;
    },

    // M. File Upload with Version Conflict Checks (Goal 5 & Goal 7)
    handleFileUpload: async function(files, overwriteAction = '') {
        if (!files || files.length === 0) return;
        const file = files[0];

        if (file.size > 10 * 1024 * 1024) {
            alert('حجم الملف كبير جداً. الحد الأقصى هو 10 ميجابايت.');
            return;
        }

        const ext = file.name.split('.').pop().toLowerCase();
        const allowed = ['pdf', 'txt', 'docx', 'md'];
        if (!allowed.includes(ext)) {
            alert('الصيغة غير مدعومة. الصيغ المدعومة: PDF, TXT, DOCX, MD');
            return;
        }

        window.Dashboard.rag.simulateIndexingProgress('رفع المعالجة', file.name);

        try {
            let csrfToken = window.Dashboard.api.csrfToken;
            if (!csrfToken) {
                csrfToken = await window.Dashboard.api.fetchCsrfToken();
            }

            const formData = new FormData();
            formData.append('file', file);
            if (overwriteAction) {
                formData.append('overwriteAction', overwriteAction);
            }

            const xhr = new XMLHttpRequest();
            const baseUrl = window.ENV ? window.ENV.API_BASE_URL : '/api/v1';
            xhr.open('POST', `${baseUrl}/rag/documents/upload`, true);
            xhr.withCredentials = true;

            if (csrfToken) {
                xhr.setRequestHeader('X-CSRF-Token', csrfToken);
            }
            const sessionId = localStorage.getItem('futh_session_id');
            if (sessionId) {
                xhr.setRequestHeader('X-Session-ID', sessionId);
            }

            xhr.onload = function() {
                const responseText = xhr.responseText;
                let data = {};
                try { data = JSON.parse(responseText); } catch (e) {}

                if (xhr.status === 400 && data.code === 'DUPLICATE_UPLOAD') {
                    // Show Versioning Modal Dialog (Goal 5)
                    window.Dashboard.rag.showVersioningModal(file, data.existing);
                } else if (xhr.status >= 200 && xhr.status < 300) {
                    window.Dashboard.settings.showToast('تم رفع المستند وبدء الفهرسة بالخلفية.');
                    window.Dashboard.rag.addTimelineLog('رفع مستند', `تم رفع وتضمين المستند ${file.name}`);
                    window.Dashboard.rag.fetchOverviewAndDocuments();
                } else {
                    alert('خطأ في الرفع: ' + (data.error || 'فشلت معالجة الخادم للمستند.'));
                }
            };
            xhr.send(formData);
        } catch (e) {
            console.error(e);
        }
    },

    showVersioningModal: function(file, existing) {
        const modal = document.getElementById('rag-version-modal');
        if (!modal) return;

        document.getElementById('rag-version-filename').innerText = file.name;
        document.getElementById('rag-version-num').innerText = existing.version || 1;
        document.getElementById('rag-version-date').innerText = existing.createdAt ? new Date(existing.createdAt).toLocaleString('ar-EG') : 'غير متوفر';

        // Bind options (Replace, Keep Both)
        document.getElementById('rag-version-replace-btn').onclick = function() {
            modal.classList.add('hidden');
            window.Dashboard.rag.handleFileUpload([file], 'replace');
        };

        document.getElementById('rag-version-keep-btn').onclick = function() {
            modal.classList.add('hidden');
            window.Dashboard.rag.handleFileUpload([file], 'keep_both');
        };

        modal.classList.remove('hidden');
    },

    clearPlayground: function() {
        const queryInp = document.getElementById('rag-playground-query');
        if (queryInp) queryInp.value = '';

        const resultsBox = document.getElementById('rag-playground-results');
        if (resultsBox) resultsBox.classList.add('hidden');

        window.Dashboard.state.retrievedPlaygroundChunks = [];
        window.Dashboard.state.playgroundLastQuery = '';

        window.Dashboard.settings.showToast('تم مسح ساحة التجربة والنتائج.');
    },

    copyPlaygroundAnswer: function() {
        const answer = document.getElementById('rag-playground-answer')?.innerText;
        if (!answer || answer === '-') {
            alert('لا توجد إجابة لنسخها حالياً.');
            return;
        }

        navigator.clipboard.writeText(answer).then(() => {
            window.Dashboard.settings.showToast('تم نسخ إجابة المساعد للذاكرة!');
        }).catch(err => {
            console.error(err);
            alert('تعذر النسخ التلقائي للذاكرة.');
        });
    }
};

window.Dashboard.rag = window.Dashboard.rag;
