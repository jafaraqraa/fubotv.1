'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {validate}=require('./challenger-a');
const run=(claim,text,tenant='t',evidenceTenant='t')=>validate({question:'?',claim,tenantId:tenant,evidence:[{id:'e1',tenantId:evidenceTenant,text}]});
test('supports a meaning-preserving fact',()=>assert.equal(run('ضمان الملحقات 6 أشهر.','كفالة الملحقات 6 أشهر.').verdict,'SUPPORTED'));
test('wrong tenant is never admissible',()=>assert.equal(run('السعر 100 شيكل.','السعر 100 شيكل.','a','b').verdict,'NOT_PROVEN'));
test('exact value conflict is contradicted',()=>assert.equal(run('السعر 120 شيكل.','السعر 100 شيكل.').verdict,'CONTRADICTED'));
test('same number on unrelated relation is not proof',()=>assert.equal(run('مدة الخدمة 100 دقيقة.','السعر 100 شيكل.').verdict,'NOT_PROVEN'));
