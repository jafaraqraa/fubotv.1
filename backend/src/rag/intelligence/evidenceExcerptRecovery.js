'use strict';
const { normalizeChunks, splitIntoSentences, validateDetailed, extractQuantities } = require('./answerValidator');
const {evaluateConditionalPolicy,policyTopics}=require('../security/conditionalPolicyGuard');
const { tableFacts } = require('../processing/tableStructure');
const { requestedFields, contentTokens } = require('./retrievalRelevance');
const { entities } = require('./conversationReferent');
const { laborAssessment } = require('./numericIdentity');

// A conservative recovery for rule questions, not another source of business
// knowledge. Copy complete relevant source statements; do not infer eligibility,
// approvals, amounts or live availability. The usual validator and final boundary
// still decide whether these excerpts can be delivered.
function recoverEvidenceExcerpt(question, context, tenantId) {
    // Amount excerpts cannot answer inclusion, refund, or availability questions.
    const liveQuestion=/(?:موعد|فني|متوفر|متاح|مخزن|مخزون)/u.test(question)
        && /اليوم|لليوم|بكرا|غدا|هسا|الآن|الان|حاليا|صح/u.test(question);
    const fields = requestedFields(question);
    const field = ['inclusion', 'age', 'minimum', 'credit', 'weekly', 'daily', 'deposit'].find(value => fields.includes(value));
    if (!tenantId) return null;
    const chunks = normalizeChunks(context).filter(chunk => String(chunk.tenantId) === String(tenantId));
    if(policyTopics(question).some(topic=>['cancellation','late_return'].includes(topic)) && extractQuantities(question).length){
        const proof=evaluateConditionalPolicy({claim:'',question,chunks,tenantId,extractQuantities});
        if(proof.active?.evidenceId){
            const answer=`${proof.active.conditionText}: ${proof.active.outcome}`;
            const validation=validateDetailed(answer,chunks,{question,tenantId});
            if(validation.overallStatus==='SUPPORTED')return {answer,validation,evidenceIds:[proof.active.evidenceId]};
        }
    }
    if(liveQuestion){
        // Recover only explicit limitations, never infer a slot, inventory,
        // cancellation, booking action or promised follow-up from a catalog.
        const lines=chunks.flatMap(chunk=>chunk.text.split(/\n+/u).map(text=>({text,id:chunk.id})));
        const relevant=lines.filter(x=>/لا تحتوي.*(?:جدول|مخزون)|لا يجوز استنتاج توفر|ضمن نطاق الخدمة لا يثبت توفر|(?:الكتالوج|القائمة) لا يثبت/u.test(x.text));
        const unique=[...new Map(relevant.map(x=>[x.text,x])).values()];
        if(!unique.length||unique.length>3)return null;
        const answer=unique.map(x=>x.text).join('\n');
        const validation=validateDetailed(answer,chunks,{question,tenantId});
        if(validation.overallStatus!=='SUPPORTED')return null;
        return {answer,validation,evidenceIds:[...new Set(unique.map(x=>x.id))]};
    }
    if (/متوفر|متاح|available/iu.test(question)) return null;
    if(field==='age' && /مستأجر|استأجر|أستأجر/u.test(question) && /أشغل|اشغل|مشغل/u.test(question)){
        const selected=chunks.flatMap(c=>splitIntoSentences(c.text).filter(line=>/مستأجر|مستاجر|مشغل/u.test(line)&&/\d/u.test(line)).map(text=>({text,id:c.id})));
        const unique=[...new Map(selected.map(x=>[x.text,x])).values()];
        if(unique.length && unique.length<=6){
            const answer=unique.map(x=>x.text).join('\n'),validation=validateDetailed(answer,chunks,{question,tenantId});
            if(validation.overallStatus==='SUPPORTED')return {answer,validation,evidenceIds:[...new Set(unique.map(x=>x.id))]};
        }
    }
    // Exact rule recovery retains complete conditions/exclusions and passes the
    // same validator and Boundary. Never synthesize a numeric result here.
    if (!field) {
        let match;
        if (/بطاري/iu.test(question) && /خصم/u.test(question)) match=/الخصم.*(?:لا يطبق|لا يشمل).*بطاري/u;
        else if (/كشف/u.test(question) && /خصم/u.test(question)) match=/(?:إذا|اذا).*أجرة الإصلاح.*(?:تُخصم|تخصم)/u;
        else if (/مكتب|مكاتب|فروع/u.test(question)) match=/(?:قائمة|قائمه).*(?:مكاتب|فروع).*(?:كاملة|كامله)/u;
        if (/كان\s+(?:مكتب|فرع)/u.test(question)) match=/^(?:حتى|من)\s+\d{4}-\d{2}-\d{2}.*(?:مكتب|فرع)/u;
        if(!match)return null;
        const officeQuestion=/مكتب|مكاتب|فروع/u.test(question);
        const laborCheck=laborAssessment(question,chunks);
        const candidates=chunks.flatMap(chunk=>String(chunk.text).split(/\n+/u)
            .filter(line=>(match.test(line) && (!laborCheck || laborCheck.satisfied || /أقل من.*فلا/u.test(line)))
                || (laborCheck && /رسوم القطع لا تدخل/u.test(line))
                || (officeQuestion && match.test(chunk.text) && (/^مكتب\s/u.test(line) || /^لا يوجد مكتب/u.test(line))))
            .map(text=>({text,id:chunk.id})));
        const unique=[...new Map(candidates.map(item=>[item.text,item])).values()];
        if(!unique.length || unique.length>4)return null;
        const answer=unique.map(item=>item.text).join('\n');
        const validation=validateDetailed(answer,chunks,{question,tenantId});
        if(validation.overallStatus!=='SUPPORTED')return null;
        return {answer,evidenceIds:[...new Set(unique.map(item=>item.id))],validation};
    }
    const codes = String(question).match(/\b[A-Za-z]+[-_]?\d+\b/gu) || [];
    const anchors = entities(question).flatMap(contentTokens);
    const candidates = [];
    for (const chunk of chunks) {
        for (const sentence of splitIntoSentences(tableFacts(chunk.text))) {
            // A trailing colon introduces conditions/list items; the header
            // alone cannot be delivered as an unconditional policy statement.
            if (/[:：]\s*$/u.test(sentence)) continue;
            if (/^\s*#/u.test(sentence) || !requestedFields(sentence).includes(field)) continue;
            const row = sentence.includes('|');
            if (field === 'inclusion' && (row || !fields.every(value=>requestedFields(sentence).includes(value)))) continue;
            if (row && sentence.split('|').length !== 2) continue;
            if (field === 'age' && !/[0-9٠-٩]/u.test(sentence)) continue;
            if (sentence.split(/\s+/u).length < 4) continue;
            const sentenceCodes = sentence.match(/\b[A-Za-z]+[-_]?\d+\b/gu) || [];
            if (codes.length && sentenceCodes.length && !codes.some(code => sentenceCodes.some(item => item.toLowerCase() === code.toLowerCase()))) continue;
            if (row && !codes.length && (!anchors.length || !anchors.every(anchor => contentTokens(sentence).includes(anchor)))) continue;
            if (row && codes.length && !codes.every(code => sentenceCodes.some(item => item.toLowerCase() === code.toLowerCase()))) continue;
            // A minimum-duration question about a specific product needs its row.
            if (['minimum','weekly','daily','deposit'].includes(field) && !row) continue;
            if (field === 'age' && !row && !/مستأجر|مستاجر|مشغل|عمر|age/iu.test(sentence)) continue;
            candidates.push({text:sentence.replace(/\*\*/g, '').trim(),id:chunk.id});
        }
    }
    const unique = [...new Map(candidates.map(item => [item.text,item])).values()];
    const rowSubjects = new Set(unique.filter(item=>item.text.includes('|')).map(item=>item.text.split('|')[0].trim()));
    if (rowSubjects.size > 1) return null;
    if (!unique.length || unique.length > 6) return null;
    const answer = unique.map(item => item.text.replace(/[.!]+$/u, '') + '.').join('\n');
    if (answer.length > 1200) return null;
    const validation = validateDetailed(answer, chunks, {question,tenantId});
    if (validation.overallStatus !== 'SUPPORTED') return null;
    return {answer,evidenceIds:[...new Set(unique.map(item=>item.id))],validation};
}
module.exports = { recoverEvidenceExcerpt };
