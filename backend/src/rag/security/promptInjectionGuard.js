const SCANNER_VERSION = 'rag-injection-guard/1.0.0';
const RISK = Object.freeze({
    SAFE: 'SAFE',
    SUSPICIOUS: 'SUSPICIOUS',
    HIGH: 'HIGH_RISK',
    BLOCKED: 'BLOCKED'
});
const metrics = {
    rag_injection_chunks_scanned_total: 0,
    rag_injection_suspicious_total: 0,
    rag_injection_blocked_total: 0,
    rag_injection_quarantined_documents_total: 0,
    rag_injection_admin_overrides_total: 0,
    rag_injection_response_blocks_total: 0
};
const quarantine = new Map();

function persistQuarantine(entry) {
    try {
        const db = require('../../database/connection');
        db.prepare(`
            INSERT INTO rag_injection_quarantine (
                quarantine_id, tenant_id, document_id, chunk_id, risk_level,
                signal_codes, scanner_version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(quarantine_id) DO UPDATE SET
                risk_level = excluded.risk_level,
                signal_codes = excluded.signal_codes,
                scanner_version = excluded.scanner_version
        `).run(
            entry.id, entry.tenantId, entry.documentId, entry.chunkId, entry.riskLevel,
            JSON.stringify(entry.signalCodes), entry.scannerVersion, entry.createdAt
        );
    } catch (_) {
        // The scanner also runs before database initialization and in isolated unit tests.
        // Runtime retrieval remains fail-closed; persistence becomes available after migration.
    }
}

const HTML_ENTITIES = Object.freeze({
    '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'",
    '&colon;': ':', '&sol;': '/'
});
const RULES = [
    ['INSTRUCTION_OVERRIDE', 6, /\b(?:ignore|disregard|forget|override)\b.{0,45}\b(?:previous|prior|system|developer|instructions?|rules?|prompt)\b|(?:تجاهل|اهمل|تخط|الغ).{0,35}(?:التعليمات|الاوامر|النظام|السابقه)/i],
    ['ROLE_OVERRIDE', 5, /\b(?:you are now|act as|pretend to be|change your role)\b|(?:انت الان|تصرف ك|غير دورك|تظاهر بانك)/i],
    ['SYSTEM_PROMPT_EXFILTRATION', 6, /\b(?:reveal|show|print|return|expose|leak|output)\b.{0,45}\b(?:system|developer|hidden|internal)\s+(?:prompt|message|instructions?|configuration)\b|(?:اكشف|اظهر|اطبع|اعرض).{0,45}(?:رساله النظام|تعليمات النظام|البرومبت|التعليمات المخفيه)/i],
    ['SECRET_EXFILTRATION', 7, /\b(?:reveal|send|print|exfiltrate|expose|return)\b.{0,50}\b(?:api[\s_-]*keys?|secrets?|passwords?|tokens?|credentials?|environment variables?)\b|(?:اكشف|ارسل|اظهر|اطبع).{0,45}(?:مفتاح|مفاتيح|اسرار|كلمات المرور|توكن|بيانات الدخول)/i],
    ['TOOL_INVOCATION', 5, /\b(?:call|invoke|execute|run|use)\b.{0,35}\b(?:tool|function|command|api|shell|terminal|curl)\b|(?:نفذ|شغل|استدع|استخدم).{0,35}(?:اداه|امر|واجهه|طرفيه|شل)/i],
    ['EXTERNAL_EXFILTRATION', 7, /\b(?:send|post|upload|transmit)\b.{0,45}\b(?:data|secrets?|credentials?|tokens?)\b.{0,35}\b(?:to|http|server|endpoint)\b|(?:ارسل|ارفع).{0,45}(?:البيانات|الاسرار|التوكن).{0,35}(?:الى|لخادم|لرابط)/i],
    ['SAFETY_BYPASS', 6, /\b(?:bypass|disable|evade)\b.{0,35}\b(?:safety|security|policy|guard|validation)\b|(?:تجاوز|عطل).{0,35}(?:الامان|الحمايه|السياسه|التحقق)/i],
    ['USER_BYPASS', 4, /\b(?:ignore|disregard|do not answer)\b.{0,35}\b(?:user|question|request)\b|(?:تجاهل|لا تجب).{0,30}(?:المستخدم|السؤال|الطلب)/i],
    ['OUTPUT_CONTROL', 2, /\b(?:answer|output|respond)\s+only\b|(?:اجب|اخرج|رد)\s+فقط/i],
    ['TENANT_ESCAPE', 7, /\b(?:switch|change|override|use)\b.{0,35}\b(?:tenant|collection|authorization|user id|index version)\b|(?:غير|بدل|استخدم).{0,35}(?:المستاجر|التينانت|المجموعه|صلاحيات|هويه المستخدم)/i],
    ['ROLE_MARKER', 2, /(?:^|\n)\s*(?:system|developer|assistant|tool)\s*(?:message)?\s*[:：]|(?:^|\n)\s*(?:النظام|المطور|المساعد)\s*[:：]/im],
    ['BOUNDARY_BREAK', 5, /<\/?(?:untrusted_document|document|context|system|developer)[^>]*>|DOCUMENT_TEXT_(?:START|END)|```(?:system|developer)/i],
    ['HIDDEN_HTML_INSTRUCTION', 4, /<!--[\s\S]{0,500}(?:ignore|system|instruction|تجاهل|النظام)[\s\S]{0,500}-->|<(?:script|style)[^>]*>[\s\S]*?<\/(?:script|style)>/i]
];

function enabled(name, fallback = true) {
    let value;
    try {
        value = require('../config/ragConfig').getConfig(name);
    } catch (_) {
        value = process.env[name];
    }
    if (value === undefined) return fallback;
    return ['true', '1'].includes(String(value).toLowerCase());
}

function configuredNumber(name, fallback) {
    try {
        const value = Number(require('../config/ragConfig').getConfig(name));
        return Number.isFinite(value) ? value : fallback;
    } catch (_) {
        const value = Number(process.env[name]);
        return Number.isFinite(value) ? value : fallback;
    }
}

function decodeEntities(text) {
    return text.replace(/&(lt|gt|amp|quot|#39|colon|sol);/gi, match =>
        HTML_ENTITIES[match.toLowerCase()] || match
    ).replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
        String.fromCodePoint(parseInt(hex, 16))
    ).replace(/&#(\d+);/g, (_, decimal) =>
        String.fromCodePoint(parseInt(decimal, 10))
    );
}

function normalizeForScan(value) {
    let text = decodeEntities(String(value || '').normalize('NFKC'))
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
        .toLowerCase()
        .replace(/[_*~`|()[\]{}]+/g, ' ')
        .replace(/[^\p{L}\p{N}<>/:'"=+.-]+/gu, ' ')
        .replace(/\s+/g, ' ').trim();
    // Collapse common single-character spacing: "i g n o r e".
    text = text.replace(/(?:\b[\p{L}]\b[\s.-]*){4,}/gu, match =>
        `${match.trim().replace(/[\s.-]+/g, '')} `
    ).replace(/\s+/g, ' ').trim();
    return text;
}

function scanText(value, metadata = {}) {
    const started = performance.now();
    metrics.rag_injection_chunks_scanned_total++;
    try {
        const original = decodeEntities(String(value || '').normalize('NFKC'))
            .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '');
        const normalized = normalizeForScan(original);
        const signals = [];
        let score = 0;
        for (const [code, weight, pattern] of RULES) {
            if (pattern.test(normalized)) {
                signals.push(code);
                score += weight;
            }
        }

        // Base64 is case-sensitive, so inspect the pre-lowercased form.
        const base64Matches = original.match(/\b[A-Za-z0-9+/]{24,}={0,2}\b/g) || [];
        for (const encoded of base64Matches.slice(0, 3)) {
            try {
                const decoded = Buffer.from(encoded, 'base64').toString('utf8');
                if (/[\x20-\x7e\u0600-\u06ff]{12}/.test(decoded)) {
                    for (const [code, weight, pattern] of RULES) {
                        if (pattern.test(normalizeForScan(decoded))) {
                            signals.push('ENCODED_INSTRUCTION', code);
                            score += weight + 3;
                            break;
                        }
                    }
                }
            } catch (_) {}
        }

        const uniqueSignals = [...new Set(signals)]
            .slice(0, configuredNumber('RAG_INJECTION_MAX_SIGNALS', 20));
        let riskLevel = RISK.SAFE;
        if (score >= 11 || uniqueSignals.includes('TENANT_ESCAPE')) riskLevel = RISK.BLOCKED;
        else if (score >= 5) riskLevel = RISK.HIGH;
        else if (score >= 2) riskLevel = RISK.SUSPICIOUS;
        const action = riskLevel === RISK.BLOCKED ? 'EXCLUDE_AND_QUARANTINE'
            : riskLevel === RISK.HIGH ? 'EXCLUDE_FROM_CONTEXT'
                : riskLevel === RISK.SUSPICIOUS ? 'INCLUDE_AS_QUOTED_EVIDENCE'
                    : 'INCLUDE';
        if (riskLevel !== RISK.SAFE) metrics.rag_injection_suspicious_total++;
        if (riskLevel === RISK.HIGH || riskLevel === RISK.BLOCKED) {
            metrics.rag_injection_blocked_total++;
            const quarantineId = [
                metadata.tenantId || 'unknown',
                metadata.documentId || 'unknown',
                metadata.chunkId || `scan-${Date.now()}`
            ].join(':');
            quarantine.set(quarantineId, {
                id: quarantineId,
                tenantId: metadata.tenantId || null,
                documentId: metadata.documentId || null,
                chunkId: metadata.chunkId || null,
                riskLevel,
                signalCodes: uniqueSignals,
                scannerVersion: SCANNER_VERSION,
                createdAt: new Date().toISOString(),
                override: null
            });
            persistQuarantine(quarantine.get(quarantineId));
            if (quarantine.size > 1000) quarantine.delete(quarantine.keys().next().value);
            metrics.rag_injection_quarantined_documents_total++;
        }
        const result = {
            riskLevel, signals: uniqueSignals, action, score,
            scannerVersion: SCANNER_VERSION,
            scannedAt: new Date().toISOString(),
            durationMs: Number((performance.now() - started).toFixed(3))
        };
        if (riskLevel !== RISK.SAFE || enabled('RAG_INJECTION_LOG_SAFE', false)) {
            console.log('[RAG Injection] Chunk scanned', {
                tenantId: metadata.tenantId || null,
                documentId: metadata.documentId || null,
                chunkId: metadata.chunkId || null,
                riskLevel, signalCodes: uniqueSignals, action,
                scannerVersion: SCANNER_VERSION
            });
        }
        return result;
    } catch (error) {
        metrics.rag_injection_blocked_total++;
        return {
            riskLevel: RISK.BLOCKED,
            signals: ['SCANNER_FAILURE'],
            action: 'EXCLUDE_AND_QUARANTINE',
            score: 100,
            scannerVersion: SCANNER_VERSION,
            scannedAt: new Date().toISOString(),
            scannerError: true
        };
    }
}

function inspectChunk(chunk) {
    const payload = chunk?.payload || {};
    const metadata = {
        tenantId: payload.tenantId || chunk?.tenantId,
        documentId: payload.documentId || chunk?.documentId,
        chunkId: payload.chunkId || chunk?.chunkId || chunk?.id
    };
    const scan = scanText(chunk?.text ?? payload.text ?? '', metadata);
    return { ...chunk, injectionGuard: scan };
}

function filterRetrievedChunks(chunks) {
    if (!enabled('RAG_INJECTION_GUARD_ENABLED') || !enabled('RAG_INJECTION_SCAN_ON_RETRIEVAL')) {
        return { allowed: chunks || [], excluded: [] };
    }
    const allowed = [];
    const excluded = [];
    const blockHighRisk = enabled('RAG_INJECTION_BLOCK_HIGH_RISK');
    for (const chunk of chunks || []) {
        const inspected = inspectChunk(chunk);
        if (inspected.injectionGuard.riskLevel === RISK.BLOCKED
            || (blockHighRisk && inspected.injectionGuard.riskLevel === RISK.HIGH)) {
            excluded.push(inspected);
            console.warn('[RAG Injection] High-risk chunk excluded', {
                riskLevel: inspected.injectionGuard.riskLevel,
                signalCodes: inspected.injectionGuard.signals,
                action: inspected.injectionGuard.action,
                scannerVersion: SCANNER_VERSION
            });
        } else {
            allowed.push(inspected);
        }
    }
    return { allowed, excluded };
}

function escapeAttribute(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

function escapeDocumentText(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function serializeChunk(chunk, index = 0) {
    const payload = chunk?.payload || {};
    const guard = chunk.injectionGuard || scanText(chunk.text ?? payload.text ?? '');
    const warning = guard.riskLevel === RISK.SUSPICIOUS
        ? ' warning="suspicious_instruction_like_content_quote_only"' : '';
    const attrs = {
        tenant_id: payload.tenantId || chunk.tenantId || '',
        document_id: payload.documentId || chunk.documentId || '',
        document_version_id: payload.documentVersionId || chunk.documentVersionId || '',
        chunk_id: payload.chunkId || chunk.chunkId || chunk.id || `chunk-${index + 1}`,
        source_type: payload.sourceType || chunk.sourceType || '',
        source_name: payload.sourceName || payload.source || chunk.sourceName || chunk.source || '',
        retrieval_score: chunk.finalScore ?? chunk.score ?? chunk.retrievalScore ?? '',
        index_version_id: payload.indexVersionId || chunk.indexVersionId || ''
    };
    const attributes = Object.entries(attrs)
        .map(([key, value]) => `${key}="${escapeAttribute(value)}"`).join(' ');
    return `<untrusted_document ${attributes}${warning}>\nDOCUMENT_TEXT_START\n${escapeDocumentText(chunk.text ?? payload.text ?? '')}\nDOCUMENT_TEXT_END\n</untrusted_document>`;
}

function serializeChunks(chunks) {
    return (chunks || []).map(serializeChunk).join('\n\n');
}

function parseSerializedChunks(value) {
    const text = String(value || '');
    if (!text.includes('<untrusted_document ')) return null;
    const decode = input => String(input || '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const chunks = [];
    for (const match of text.matchAll(
        /<untrusted_document\s+([^>]*)>\s*DOCUMENT_TEXT_START\s*([\s\S]*?)\s*DOCUMENT_TEXT_END\s*<\/untrusted_document>/g
    )) {
        const attrs = match[1];
        const attr = name => decode(attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] || '');
        chunks.push({
            text: decode(match[2]),
            tenantId: attr('tenant_id'),
            documentId: attr('document_id'),
            documentVersionId: attr('document_version_id'),
            chunkId: attr('chunk_id'),
            sourceType: attr('source_type'),
            sourceName: attr('source_name'),
            retrievalScore: Number(attr('retrieval_score')) || 0,
            indexVersionId: attr('index_version_id')
        });
    }
    return chunks;
}

function redactSecrets(value) {
    let text = String(value || '');
    const patterns = [
        /\bsk-[A-Za-z0-9_-]{12,}\b/g,
        /\b(?:api[_ -]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_./+-]{8,}["']?/gi,
        /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b/g,
        /RAG SECURITY POLICY \(TRUSTED SERVER INSTRUCTION\)[\s\S]*/gi,
        /\b(?:SYSTEM|DEVELOPER) (?:PROMPT|INSTRUCTIONS?)\s*:\s*[\s\S]*/gi
    ];
    for (const pattern of patterns) text = text.replace(pattern, '[REDACTED_SECRET]');
    if (text !== String(value || '')) metrics.rag_injection_response_blocks_total++;
    return text;
}

function getMetrics() {
    return { ...metrics };
}

function getQuarantineReport({ tenantId, isAdmin } = {}) {
    if (!isAdmin) {
        const error = new Error('Administrator authorization is required.');
        error.code = 'RAG_INJECTION_ADMIN_REQUIRED';
        throw error;
    }
    let report = [...quarantine.values()].filter(item => !tenantId || item.tenantId === tenantId);
    try {
        const db = require('../../database/connection');
        const rows = tenantId
            ? db.prepare('SELECT * FROM rag_injection_quarantine WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1000').all(tenantId)
            : db.prepare('SELECT * FROM rag_injection_quarantine ORDER BY created_at DESC LIMIT 1000').all();
        const merged = new Map(report.map(item => [item.id, item]));
        rows.forEach(row => merged.set(row.quarantine_id, {
            id: row.quarantine_id,
            tenantId: row.tenant_id,
            documentId: row.document_id,
            chunkId: row.chunk_id,
            riskLevel: row.risk_level,
            signalCodes: JSON.parse(row.signal_codes || '[]'),
            scannerVersion: row.scanner_version,
            createdAt: row.created_at,
            override: row.review_decision ? {
                decision: row.review_decision,
                adminId: row.reviewed_by,
                reason: row.review_reason,
                reviewedAt: row.reviewed_at
            } : null
        }));
        report = [...merged.values()];
    } catch (_) {}
    return report;
}

function applyAdminOverride({ quarantineId, tenantId, adminId, reason, decision, isAdmin } = {}) {
    if (!isAdmin || !adminId || !reason || !['approve', 'reject'].includes(decision)) {
        const error = new Error('Authorized administrator and audit reason are required.');
        error.code = 'RAG_INJECTION_ADMIN_REQUIRED';
        throw error;
    }
    const entry = quarantine.get(quarantineId);
    if (!entry || (tenantId && entry.tenantId !== tenantId)) {
        const error = new Error('Quarantined item was not found in the authorized tenant.');
        error.code = 'RAG_INJECTION_QUARANTINE_NOT_FOUND';
        throw error;
    }
    // An override permits administrative review/re-index decisions. It never bypasses
    // the runtime retrieval gate or injects the content into a model prompt.
    entry.override = {
        adminId: String(adminId),
        reason: String(reason).slice(0, 500),
        decision,
        reviewedAt: new Date().toISOString()
    };
    try {
        const db = require('../../database/connection');
        db.prepare(`
            UPDATE rag_injection_quarantine SET
                review_decision = ?, reviewed_by = ?, review_reason = ?,
                reviewed_at = CURRENT_TIMESTAMP
            WHERE quarantine_id = ? AND tenant_id = ?
        `).run(decision, String(adminId), String(reason).slice(0, 500),
            quarantineId, entry.tenantId);
    } catch (_) {}
    metrics.rag_injection_admin_overrides_total++;
    console.warn('[RAG Injection] Administrative review recorded', {
        quarantineId, tenantId: entry.tenantId, adminId: String(adminId),
        scannerVersion: SCANNER_VERSION
    });
    return { ...entry };
}

module.exports = {
    SCANNER_VERSION, RISK, normalizeForScan, scanText, inspectChunk,
    filterRetrievedChunks, serializeChunk, serializeChunks, parseSerializedChunks,
    redactSecrets, getMetrics,
    getQuarantineReport, applyAdminOverride
};
