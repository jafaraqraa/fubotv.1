const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {extractTextFromBuffer} = require('../src/rag/loaders/documentExtractionService');
const fixture = name => fs.readFileSync(path.join(__dirname,'fixtures/reliability',name));
test('installed PDF v2 extracts real PDF text', async () => {
 assert.match(await extractTextFromBuffer('pdf',fixture('readable.pdf')),/ZX55 daily price 315 ILS/);
});
test('DOCX extraction retains cells and row boundaries', async () => {
 const text=await extractTextFromBuffer('docx',fixture('table.docx'));
 assert.match(text,/Product \| Daily ILS \| Weekly ILS\nZX55 \| 315 \| 1800/);
});
test('empty and corrupt documents fail visibly', async () => {
 await assert.rejects(extractTextFromBuffer('txt',Buffer.from('   ')));
 await assert.rejects(extractTextFromBuffer('pdf',Buffer.from('%PDF broken')));
});
