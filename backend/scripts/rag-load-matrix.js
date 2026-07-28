#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const levels = String(process.env.RAG_LOAD_LEVELS || '10,50,100,250,500,1000')
    .split(',').map(Number).filter(value => Number.isInteger(value) && value > 0);
const requestsPerUser = Math.max(1, Number(process.env.RAG_LOAD_REQUESTS_PER_USER || 10));
const runner = path.join(__dirname, 'rag-load-runner.js');

for (const concurrency of levels) {
    console.log(`[RAG Load Matrix] concurrency=${concurrency}`);
    const result = spawnSync(process.execPath, [
        runner,
        '--scenario', 'retrieval',
        '--concurrency', String(concurrency),
        '--requests', String(concurrency * requestsPerUser)
    ], { stdio: 'inherit', env: process.env });
    if (result.status !== 0) {
        console.error(`[RAG Load Matrix] stopped at concurrency=${concurrency}`);
        process.exit(result.status || 1);
    }
}
