'use strict';
// Linguistic equivalences only. No business facts or default units are added.
function normalizeProposition(text) {
 return String(text || '').normalize('NFKC')
  .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[إأآٱ]/g, 'ا').replace(/ة/g, 'ه')
  .replace(/^(?:لا|اه|نعم)\s*[.،,—-]\s*/u, '')
  .replace(/(?:ما\s+يعنيش|ما\s+يعني|لا\s+يعني|ما\s+بيثبت|لا\s+يثبت)/gu, 'لا يثبت')
  .replace(/(?:ما\s+(?:بصير|بيصير)|لا\s+يصبح)/gu, 'لا يصبح')
  .replace(/ما في سعر ثابت/gu, 'لا يوجد سعر ثابت')
  .replace(/(?:فيك|بامكانك)\s+تطلب/gu, 'يمكن طلب')
  .replace(/(?:مش\s+مخزون\s+حي|لا\s+يساوي\s+مخزونا?\s+حيا?)/gu, 'لا يثبت توفر المخزون')
  .replace(/(?:بالقائمه|في القائمه)/gu, 'في الكتالوج')
  .replace(/(?:بالمخزن|في المخزن)/gu, 'في المخزون');
}
module.exports={normalizeProposition};
