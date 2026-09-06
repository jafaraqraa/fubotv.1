const { normalizeArabic } = require('../../src/rag/processing/arabicNormalizer');

// Retrieval hints, not entailment rules. Passing coverage never validates an answer.
const patterns = Object.freeze({
    PRICE: /سعر|اسعار|تكلف|ثمن|price|cost/iu,
    DEPOSIT: /تامين|deposit/iu,
    DURATION: /مده|حد ادني|يوم واحد|يومين|minimum|duration/iu,
    AGE: /عمر|عمري|سن |age/iu,
    WORKING_HOURS: /دوام|ساعات العمل|فاتح|مفتوح|hours/iu,
    LOCATION: /عنوان|موقع|فرع|فروع|location|address/iu,
    CREDIT: /اجل|ائتمان|credit/iu,
    POLICY: /سياس|الغ|خصم|تاخر|استرجاع|استرداد|policy|refund|discount/iu,
    DELIVERY: /توصيل|شحن|delivery|shipping/iu,
    AVAILABILITY: /متوفر|متاح|موجوده|availability|available/iu
});
const norm = text => normalizeArabic(String(text || '')).toLowerCase();
function requestedRelations(query) {
    const q = norm(query);
    const relations = Object.entries(patterns).filter(([, pattern]) => pattern.test(q)).map(([key]) => key);
    if (!relations.includes('PRICE') && /لليوم|بالاسبوع|والاسبوع|daily|weekly/iu.test(q)) relations.push('PRICE');
    return relations;
}
const tokens = text => norm(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    .map(t => t.replace(/^(?:وال|بال|لل|ال)(?=\p{L}{3})/u, ''));
const filler = new Set(['قديش', 'كم', 'شو', 'طيب', 'يعني', 'بقدر', 'سعر', 'سعرها', 'تامين', 'عليها', 'عليه', 'لليوم', 'اسبوع', 'يوم', 'واحد', 'بدي', 'انا']);
function entityTokens(query) {
    return tokens(query).filter(t => t.length > 2 && !filler.has(t)
        && !/^\d+$/.test(t) && !Object.values(patterns).some(p => p.test(t)));
}
function tableRows(text) {
    const lines = String(text || '').split('\n');
    const result = [];
    const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    for (let i = 1; i < lines.length; i++) {
        if (!/^\s*\|?\s*:?-{3,}/.test(lines[i]) || !lines[i - 1].includes('|')) continue;
        const headers = cells(lines[i - 1]);
        for (let j = i + 1; j < lines.length && lines[j].includes('|'); j++) {
            const values = cells(lines[j]);
            if (values.length === headers.length) result.push({ entity: values[0], headers, values });
        }
    }
    return result;
}
function matchedRelations(query, text) {
    const requested = requestedRelations(query);
    const evidence = norm(text);
    const rows = tableRows(text);
    const amount = /قديش|كم|amount|how much/iu.test(norm(query));
    return requested.filter(relation => {
        const pattern = patterns[relation];
        const tableMatch = rows.some(row => row.headers.some((header, i) =>
            (pattern.test(norm(header)) || relation === 'PRICE' && /يومي|اسبوعي|daily|weekly/iu.test(norm(header)))
            && (!amount || /\d|[٠-٩]/u.test(row.values[i]))));
        if (tableMatch) return true;
        if (!pattern.test(evidence)) return false;
        if (amount && ['PRICE', 'DEPOSIT'].includes(relation)) {
            // A value must follow the requested field in its own clause.
            return String(text).split(/[\n.!؟؛،]+/u).some(line => {
                const normalized = norm(line);
                const match = normalized.match(pattern);
                if (!match) return false;
                const tail = normalized.slice(match.index + match[0].length);
                return /^[^\d]{0,35}\d/u.test(tail) && !/لا يشمل|غير شامل|مستثن|exclud/iu.test(normalized);
            });
        }
        return true;
    });
}
function relationCoverage(query, chunks) {
    const requested = requestedRelations(query);
    const covered = new Set(chunks.flatMap(c => matchedRelations(query, c.text || c.payload?.text || '')));
    const missing = requested.filter(r => !covered.has(r));
    return { requested, covered: [...covered], missing, sufficient: missing.length === 0 };
}
function evidenceAffinity(query, chunk) {
    const text = chunk.text || chunk.payload?.text || '';
    const wanted = entityTokens(query);
    const evidenceTokens = new Set(tokens(text));
    const entityOverlap = wanted.filter(t => evidenceTokens.has(t)).length;
    const rows = tableRows(text);
    const tableEntity = rows.some(row => tokens(row.entity).some(t => wanted.includes(t)));
    const covered = matchedRelations(query, text);
    return { covered, entityOverlap, exactRelationEntity: covered.length > 0 && entityOverlap > 0,
        priority: covered.length * 2 + (tableEntity && covered.length ? 3 : 0) + Math.min(entityOverlap, 2) };
}
function prioritizeEvidence(query, chunks) {
    const pending = chunks.map((chunk, index) => ({ chunk, index, ...evidenceAffinity(query, chunk) }));
    const uncovered = new Set(requestedRelations(query));
    const result = [];
    while (pending.length) {
        pending.sort((a, b) => {
            const score = item => item.priority + item.covered.filter(r => uncovered.has(r)).length * 4;
            return score(b) - score(a) || a.index - b.index;
        });
        const next = pending.shift();
        result.push(next.chunk);
        next.covered.forEach(r => uncovered.delete(r));
    }
    return result;
}
function explicitEntities(text) {
    const codes = String(text || '').match(/\b[A-Za-z]{1,12}[-_]?[0-9]{1,8}\b/g) || [];
    if (codes.length) return [...new Set(codes)];
    const phrases = String(text || '').match(/(?:^|\s)((?:ال[\p{Script=Arabic}]{3,})(?:\s+ال[\p{Script=Arabic}]{3,})?)/gu) || [];
    return phrases.map(s => s.trim()).filter(s => !requestedRelations(s).length
        && !/اسبوع|يوم|مبلغ|سابق|تفاصيل/u.test(norm(s)));
}
function resolveReferent(query, history = []) {
    const explicit = explicitEntities(query);
    const short = tokens(query).length <= 6;
    const reference = short && /عليها|عليه|الها|اله|اياها|اياه|هاي|هاظ|هذي|هذا|سعرها|سعره|^(?:و|طيب).*(?:اسبوع|مده|سعر|تامين)/u.test(norm(query));
    if (!reference) return { status: 'NOT_REQUIRED', entity: null, query };
    if (explicit.length === 1) return { status: 'EXPLICIT', entity: explicit[0], query };
    const entities = [...new Set(history.filter(m => m?.role === 'user').slice(-6)
        .flatMap(m => explicitEntities(m.content)))];
    if (entities.length !== 1) return { status: entities.length ? 'AMBIGUOUS' : 'UNRESOLVED', entity: null, query };
    return { status: 'RESOLVED', entity: entities[0], query: `${query} ${entities[0]}` };
}
module.exports = { requestedRelations, relationCoverage, evidenceAffinity, prioritizeEvidence, resolveReferent, tableRows };
