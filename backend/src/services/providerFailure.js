'use strict';
function providerFailure(error){
 const message=String(error?.message || error || '');
 if(/key limit exceeded|quota|insufficient.*(?:credit|balance)|payment required|credit.*exhausted/i.test(message))return {kind:'BUDGET_EXHAUSTED',retryable:false,message:'تعذر توليد الرد: حد استخدام مزوّد الذكاء الاصطناعي مستنفد. يلزم مراجعة المسؤول.'};
 if(/timeout|timed out|abort/i.test(message))return {kind:'TIMEOUT',retryable:true,message:'تعذر توليد الرد بسبب انتهاء مهلة مزوّد الذكاء الاصطناعي.'};
 return {kind:'PROVIDER_UNAVAILABLE',retryable:true,message:'تعذر توليد الرد بسبب مشكلة تقنية لدى مزوّد الذكاء الاصطناعي.'};
}
module.exports={providerFailure};
