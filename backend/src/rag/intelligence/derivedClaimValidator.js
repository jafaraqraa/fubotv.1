const { normalizeNumbers, productCodes, identityRows } = require('./numericIdentity');
const DERIVED_STATUS = Object.freeze({
    SUPPORTED: 'SUPPORTED_DERIVED',
    NOT_PROVEN: 'NOT_PROVEN'
});

const CURRENT = /(?:اليوم|الان|حاليا|هسا|today|now|currently)/iu;
// Match Arabic derivational families rather than one nominal surface form:
// خفض/تخفيض/ينخفض and زاد/زيادة, plus the common ارتفاع family.
const DISCOUNT = /(?:خصم|خف(?:ا)?[ضظ]|تخفيض|discount)/iu;
const INCREASE = /(?:زياد|يزيد|تزيد|ارتفا|يرتفع|ترتفع|اضاف|increase|markup)/iu;
const ADD = /(?:المجموع|الاجمالي|جمع|زائد|\+|total|sum|plus)/iu;
const SUBTRACT = /(?:الفرق|ناقص|طرح|-|difference|minus)/iu;
const MULTIPLY = /(?:ضرب|مرات|×|\*|multiply|times)/iu;
const DIVIDE = /(?:قسم|تقسيم|÷|\/|divide)/iu;
const SCOPE_LINK = /(?:على|لـ|ل|بنسبه|نسبه|يطبق|ينطبق|يشمل|خاص\s+ب|appl(?:y|ies)|for)/iu;

function normalize(text) {
    return normalizeNumbers(text).normalize('NFKC').toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[إأآٱ]/g, 'ا')
        .replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/[^\p{L}\p{N}%+*/.-]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function unit(raw = '') {
    const value = normalize(raw);
    if (/%|بالمئ/.test(value)) return 'PERCENT';
    if (/شيكل|شيقل|شواكل|شواقل|ils/.test(value)) return 'ILS';
    if (/دولار|usd/.test(value)) return 'USD';
    if (/ساع/.test(value)) return 'HOUR';
    if (/دقيق/.test(value)) return 'MINUTE';
    if (/يوم|ايام/.test(value)) return 'DAY';
    return 'UNSPECIFIED';
}

function quantities(text) {
    const source = normalize(text);
    const pattern = /(?<![\p{L}\p{N}])(\d+(?:[.,]\d+)?)\s*(%|بالمئه|بالمائه|شيكل|شيقل|شواكل|شواقل|ils|دولار|دولارات|usd|ساعه|ساعات|دقيقه|دقائق|يوم|ايام)?(?![\p{L}\p{N}])/giu;
    return [...source.matchAll(pattern)].map(match => ({
        value: Number(match[1].replace(',', '.')),
        unit: unit(match[2]),
        index: match.index
    })).filter(item => Number.isFinite(item.value));
}

const GENERIC = new Set(['اذا', 'كان', 'كانت', 'كم', 'قديش', 'بصير', 'يصبح', 'السعر', 'قيمه', 'بعد', 'مع', 'عندي', 'هو', 'هي', 'من', 'في', 'على', 'فقط']);
function scopeTokens(text) {
    return normalize(text).split(/\s+/).map(token => {
        let value = token.startsWith('ال') && token.length > 4 ? token.slice(2) : token;
        if (value.endsWith('ات') && value.length > 4) value = value.slice(0, -2);
        if (value.endsWith('ه') && value.length > 3) value = value.slice(0, -1);
        return value;
    }).filter(token => token.length > 2
        && !GENERIC.has(token) && !/^\d/.test(token)
        && !['شيقل', 'شيكل', 'دولار', 'خصم', 'تخفيض', 'زياده'].includes(token));
}

function chunkId(chunk) { return String(chunk?.id || chunk?.chunkId || '').trim(); }
function chunkTenant(chunk) { return String(chunk?.tenantId || chunk?.payload?.tenantId || '').trim(); }

function temporallyValid(chunk, question, now = new Date()) {
    if (!CURRENT.test(normalize(question))) return true;
    const from = chunk.validFrom || chunk.payload?.validFrom;
    const to = chunk.validTo || chunk.payload?.validTo;
    if (!from && !to) return true;
    const instant = now instanceof Date ? now : new Date(now);
    if (from && instant < new Date(`${from}T00:00:00Z`)) return false;
    if (to && instant > new Date(`${to}T23:59:59Z`)) return false;
    return true;
}

function trustedChunks(chunks, tenantId, question, now) {
    if (!Array.isArray(chunks) || !chunks.length) return [];
    const owners = new Set(chunks.map(chunkTenant).filter(Boolean));
    if (owners.size > 1) return [];
    return chunks.filter(chunk => chunkId(chunk)
        && (!tenantId || chunkTenant(chunk) === String(tenantId))
        && temporallyValid(chunk, question, now));
}

function detectOperation(text) {
    if (DISCOUNT.test(text)) return 'PERCENT_DISCOUNT';
    // The claim may name the increase while the percentage itself lives only
    // in trusted evidence; validatePercent still requires and binds that rate.
    if (INCREASE.test(text)) return 'PERCENT_INCREASE';
    if (ADD.test(text)) return 'ADD';
    if (SUBTRACT.test(text)) return 'SUBTRACT';
    if (MULTIPLY.test(text)) return 'MULTIPLY';
    if (DIVIDE.test(text)) return 'DIVIDE';
    return null;
}

function close(left, right) { return Math.abs(left - right) <= 0.01; }

function userCount(text) {
    const explicit=quantities(text).find(value=>value.unit==='UNSPECIFIED' && value.value>0);
    if(explicit)return {...explicit,source:'USER_INPUT',evidenceId:null};
    const value=normalize(text);
    // Arabic count words are user inputs, never business evidence.
    if(/(?:^|\s)(?:اثنتين|اثنين|اتنين|ثنتين|وحدتين|قطعتين)(?:\s|$)/u.test(value))return {value:2,unit:'UNSPECIFIED',source:'USER_INPUT',evidenceId:null};
    if(/(?:^|\s)(?:واحده|واحد)(?:\s|$)/u.test(value))return {value:1,unit:'UNSPECIFIED',source:'USER_INPUT',evidenceId:null};
    return null;
}

const UNIT_PRICE=/(?:سعر|ثمن|تكلف).*(?:وحد|قطع|عنصر|جهاز)|(?:للوحد|للقطع|للقطعه|لكل\s+(?:وحد|قطع|عنصر|جهاز))/u;
const FEE_RELATION=/(?:تركيب|تهيئ|اعداد|توصيل|زيار|setup|install|delivery)/u;
const ONE_TIME=/(?:اجمالي|كامل|مره\s+واحد|لا\s+تتكرر|لا\s+يتكرر|نفس\s+الزيار|فقط\s+للزيار|one.time|same.visit|not.repeat)/u;
function monetaryStatements(chunk){
    const lines=String(chunk.text||'').split(/\n+|(?<=[.!؟])\s+/u).map(x=>x.replace(/[*_`]/g,'').trim()).filter(Boolean);
    let heading='';const result=[];
    for(let i=0;i<lines.length;i++){
        if(/^#+\s*/u.test(lines[i]))heading=lines[i].replace(/^#+\s*/u,'');
        const money=quantities(lines[i]).filter(x=>['ILS','USD'].includes(x.unit));
        if(!money.length)continue;
        const previous=lines[i-1]||'',current=lines[i],next=lines[i+1]||'';
        const text=[heading,previous,current,next].filter(Boolean).join(' ');
        result.push(...money.map(value=>({...value,text,normalized:normalize(text),current:normalize(current),previous:normalize(previous),next:normalize(next),evidenceId:chunkId(chunk),chunk})));
    }
    return result;
}

function validateQuantityWithOneTimeFee({claim,question,chunks}){
    const output=quantities(claim).filter(x=>['ILS','USD'].includes(x.unit)).at(-1),count=userCount(question);
    if(!output||!count||count.value<=0)return null;
    const target=new Set(scopeTokens(`${question} ${claim}`));
    const scoped=text=>{const tokens=new Set(scopeTokens(text));return [...target].some(x=>tokens.has(x));};
    const statements=chunks.flatMap(monetaryStatements);
    const unitPrices=statements.filter(x=>UNIT_PRICE.test(x.normalized)&&scoped(x.text));
    const fees=statements.filter(x=>FEE_RELATION.test(x.normalized)&&scoped(x.text));
    for(const price of unitPrices)for(const fee of fees){
        if(price.unit!==output.unit||fee.unit!==output.unit)continue;
        // The one-time marker must be adjacent to this fee proposition. Its
        // presence elsewhere in the same chunk/document proves nothing.
        const nextContinuesFee=/(?:لا\s+تتكرر|لا\s+يتكرر|تبقي).*(?:اجر|رسم|fee)/u.test(fee.next);
        if(!ONE_TIME.test(`${fee.previous} ${fee.current}`)&&!nextContinuesFee)continue;
        if(!FEE_RELATION.test(normalize(question)))continue;
        const expected=count.value*price.value+fee.value;
        if(!close(expected,output.value))continue;
        // If the model exposes operands, they must agree with the proven inputs.
        const claimedMoney=quantities(claim).filter(x=>['ILS','USD'].includes(x.unit));
        const subtotal=count.value*price.value;
        if(claimedMoney.some(x=>![price.value,fee.value,subtotal,output.value].some(v=>close(v,x.value))))continue;
        const evidenceIds=[...new Set([price.evidenceId,fee.evidenceId])];
        const relationLines=chunks.filter(c=>chunkId(c)===fee.evidenceId).flatMap(c=>String(c.text).split(/\n+/u))
            .filter(line=>FEE_RELATION.test(normalize(line))||ONE_TIME.test(normalize(line))||quantities(line).some(x=>x.unit===fee.unit&&close(x.value,fee.value)));
        return {operation:'ADD_MULTIPLY',relation:'TOTAL_PRICE',evidenceText:[price.text,...relationLines].join('\n'),inputs:[
            {value:count.value,unit:'UNSPECIFIED',source:'USER_INPUT',evidenceId:null,semanticRole:'QUANTITY'},
            {value:price.value,unit:price.unit,source:'EVIDENCE',evidenceId:price.evidenceId,semanticRole:'UNIT_PRICE'},
            {value:fee.value,unit:fee.unit,source:'EVIDENCE',evidenceId:fee.evidenceId,semanticRole:'ONE_TIME_FEE'}
        ],scopeEvidenceIds:evidenceIds,evidenceIds,expectedResult:{value:Number(expected.toFixed(2)),unit:output.unit}};
    }
    return null;
}
function validateHistoricalPrice({claim,question,chunks}){
    const date=normalize(question).match(/(?:شهر|month)\s+(\d{1,2})\s+(?:سنه|عام|year)\s+(\d{4})/u),codes=productCodes(question);
    const output=quantities(claim).filter(x=>['ILS','USD'].includes(x.unit)).at(-1);
    if(!date||codes.length!==1||!output)return null;
    const instant=new Date(Date.UTC(Number(date[2]),Number(date[1])-1,15)),code=codes[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s*');
    for(const chunk of chunks){const source=normalizeNumbers(chunk.text).replace(/[*_`]/g,' ').replace(/\s+/g,' ');
        const ranges=[...source.matchAll(new RegExp(`(?:حتى|الي)\\s+(?:تاريخ\\s*)?[:：]?\\s*(\\d{4}-\\d{2}-\\d{2})[^.]{0,100}?كان\\s+(?:سعر|ثمن|تكلفه)\\s+${code}[^.]{0,50}?(\\d+(?:\\.\\d+)?)\\s*(شيكل|شيقل|ILS|USD|دولار)`,'giu'))];
        for(const match of ranges){const end=new Date(match[1]+'T23:59:59Z'),value=Number(match[2]),currency=/USD|دولار/i.test(match[3])?'USD':'ILS';
            if(instant<=end&&currency===output.unit&&close(value,output.value))return {operation:'HISTORICAL_RANGE_LOOKUP',relation:'HISTORICAL_PRICE',evidenceText:match[0],inputs:[{value:date[1],unit:'MONTH',source:'USER_INPUT',evidenceId:null,semanticRole:'QUERY_MONTH'},{value:date[2],unit:'YEAR',source:'USER_INPUT',evidenceId:null,semanticRole:'QUERY_YEAR'},{value,unit:currency,source:'EVIDENCE',evidenceId:chunkId(chunk),semanticRole:'HISTORICAL_PRICE'}],scopeEvidenceIds:[chunkId(chunk)],evidenceIds:[chunkId(chunk)],expectedResult:{value,unit:currency}};}
    }
    return null;
}

function validatePercent({ operation, claim, question, chunks }) {
    // A percentage may be mentioned after the resulting amount. Select the
    // last monetary result, not simply the last numeric token in the sentence.
    const output = quantities(claim).filter(item => ['ILS', 'USD'].includes(item.unit)).at(-1);
    if (!output) return null;
    const userValues = quantities(question).filter(item => item.unit === output.unit);
    const bases = [];
    const targetCodes = productCodes(question).length ? productCodes(question) : productCodes(claim);
    for (const chunk of chunks) for (const value of quantities(targetCodes.length ? identityRows(chunk.text,targetCodes).join('\n') : chunk.text)) {
        if (value.unit === output.unit) bases.push({ ...value, source: 'EVIDENCE', evidenceId: chunkId(chunk), chunk });
    }
    // A customer's quoted catalog price is not authoritative product evidence.
    if (!targetCodes.length) for (const value of userValues) bases.push({ ...value, source: 'USER_INPUT', evidenceId: null });
    const targetTokens = new Set(scopeTokens(`${question} ${claim}`));
    const discounts = [];
    for (const chunk of chunks) {
        if (!(operation === 'PERCENT_DISCOUNT' ? DISCOUNT : INCREASE).test(chunk.text)) continue;
        if (!SCOPE_LINK.test(chunk.text)) continue;
        const evidenceTokens = new Set(scopeTokens(chunk.text));
        const scopeOverlap = [...targetTokens].some(token => evidenceTokens.has(token));
        if (!scopeOverlap) continue;
        const rateText=String(chunk.text).split(/\n+|(?<=[.!?؟])\s+/u)
            .filter(line=>(operation === 'PERCENT_DISCOUNT' ? DISCOUNT : INCREASE).test(line)).join('\n');
        for (const value of quantities(rateText).filter(item => item.unit === 'PERCENT')) {
            discounts.push({ ...value, evidenceId: chunkId(chunk), chunk });
        }
    }
    for (const base of bases) for (const percent of discounts) {
        if (quantities(claim).some(value=>value.unit==='PERCENT' && !close(value.value,percent.value))) continue;
        if (quantities(claim).some(value=>value.unit===output.unit && !close(value.value,output.value) && !close(value.value,base.value))) continue;
        const rule=normalizeNumbers(percent.chunk.text).replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[إأآٱ]/g,'ا');
        const threshold=rule.match(/(\d+(?:\.\d+)?)\s*(?:شيكل|شيقل|ILS|USD|دولار)\s+او اكثر/iu);
        if (threshold && base.value < Number(threshold[1])) continue;
        if (base.source === 'EVIDENCE') {
            const baseTokens = new Set(scopeTokens(base.chunk.text));
            if (![...targetTokens].some(token => baseTokens.has(token))) continue;
        }
        const expected = operation === 'PERCENT_DISCOUNT'
            ? base.value * (1 - percent.value / 100)
            : base.value * (1 + percent.value / 100);
        if (!close(expected, output.value)) continue;
        const evidenceIds = [...new Set([base.evidenceId, percent.evidenceId].filter(Boolean))];
        return {
            operation,
            inputs: [
                { value: base.value, unit: base.unit, evidenceId: base.evidenceId, source: base.source, semanticRole: 'BASE_VALUE' },
                { value: percent.value, unit: 'PERCENT', evidenceId: percent.evidenceId, source: 'EVIDENCE', semanticRole: operation === 'PERCENT_DISCOUNT' ? 'DISCOUNT' : 'INCREASE' }
            ],
            scopeEvidenceIds: [percent.evidenceId], evidenceIds,
            expectedResult: { value: Number(expected.toFixed(2)), unit: output.unit }
        };
    }
    return null;
}

function validateBinary({ operation, claim, question, chunks }) {
    const output = quantities(claim).at(-1);
    if (!output) return null;
    const inputs = [];
    const targetTokens = new Set(scopeTokens(`${question} ${claim}`));
    for (const chunk of chunks) for (const value of quantities(chunk.text)) {
        const evidenceTokens = new Set(scopeTokens(chunk.text));
        if (![...targetTokens].some(token => evidenceTokens.has(token))) continue;
        if (value.unit === output.unit || value.unit === 'UNSPECIFIED') {
            inputs.push({ ...value, evidenceId: chunkId(chunk), source: 'EVIDENCE', chunk });
        }
    }
    for (const value of quantities(question)) {
        if (value.unit === output.unit || value.unit === 'UNSPECIFIED') {
            inputs.push({ ...value, evidenceId: null, source: 'USER_INPUT' });
        }
    }
    for (let i = 0; i < inputs.length; i++) for (let j = i + 1; j < inputs.length; j++) {
        const left = inputs[i], right = inputs[j];
        if (left.source === 'EVIDENCE' && right.source === 'EVIDENCE'
            && left.evidenceId === right.evidenceId && chunks.length > 1) continue;
        const compatible = ['ADD', 'SUBTRACT'].includes(operation)
            ? left.unit === output.unit && right.unit === output.unit
            : left.unit === output.unit && right.unit === 'UNSPECIFIED';
        if (!compatible) continue;
        let expected;
        if (operation === 'ADD') expected = left.value + right.value;
        if (operation === 'SUBTRACT') expected = left.value - right.value;
        if (operation === 'MULTIPLY') expected = left.value * right.value;
        if (operation === 'DIVIDE' && right.value !== 0) expected = left.value / right.value;
        if (!Number.isFinite(expected) || !close(expected, output.value)) continue;
        const evidenceIds = [...new Set([left.evidenceId, right.evidenceId].filter(Boolean))];
        return { operation, inputs: [left, right].map((item, index) => ({
            value: item.value, unit: item.unit, evidenceId: item.evidenceId,
            source: item.source, semanticRole: `OPERAND_${index + 1}`
        })), scopeEvidenceIds: [], evidenceIds,
        expectedResult: { value: Number(expected.toFixed(2)), unit: output.unit } };
    }
    return null;
}

function validateDerivedClaim({ claim, question = '', chunks = [], tenantId = '', now = new Date() }) {
    const trusted = trustedChunks(chunks, tenantId, question, now);
    if (!trusted.length) return { status: DERIVED_STATUS.NOT_PROVEN, reason: 'untrusted_or_missing_provenance' };
    const historical=validateHistoricalPrice({claim,question,chunks:trusted});
    if(historical)return {status:DERIVED_STATUS.SUPPORTED,provenance:historical};
    // ISO dates and clock punctuation are facts, not arithmetic operators.
    // Never derive a historical clock/date from unrelated numbers in a chunk.
    if (/\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}/u.test(normalizeNumbers(claim))) {
        return {status:DERIVED_STATUS.NOT_PROVEN,reason:'temporal_fact_requires_direct_evidence'};
    }
    const compound=validateQuantityWithOneTimeFee({claim,question,chunks:trusted});
    if(compound)return {status:DERIVED_STATUS.SUPPORTED,provenance:compound};
    const operation = detectOperation(`${question} ${claim}`);
    if (!operation) return { status: DERIVED_STATUS.NOT_PROVEN, reason: 'not_derived' };
    const provenance = operation.startsWith('PERCENT_')
        ? validatePercent({ operation, claim, question, chunks: trusted })
        : validateBinary({ operation, claim, question, chunks: trusted });
    if (!provenance || !provenance.evidenceIds.length) {
        return { status: DERIVED_STATUS.NOT_PROVEN, reason: 'premises_not_proven' };
    }
    return { status: DERIVED_STATUS.SUPPORTED, provenance };
}

module.exports = { DERIVED_STATUS, validateDerivedClaim };
