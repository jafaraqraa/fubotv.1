#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const sources = [
    ['src/app.js', 'mixed'],
    ['src/routes/auth.js', 'public-or-route-auth'],
    ['src/routes/webhooks.js', 'signature-or-challenge'],
    ['src/routes/api.js', 'administrator-session+csrf'],
    ['src/analytics/analytics.routes.js', 'administrator-session+csrf']
];
const endpoints = [];
const pattern = /(?:router|app)\.(get|post|put|patch|delete)\(\s*(\[[^\]]+\]|['"`][^'"`]+['"`])/g;

for (const [relative, auth] of sources) {
    const absolute = path.join(__dirname, '..', relative);
    const content = fs.readFileSync(absolute, 'utf8');
    let match;
    while ((match = pattern.exec(content))) {
        const paths = match[2].startsWith('[')
            ? [...match[2].matchAll(/['"`]([^'"`]+)['"`]/g)].map(item => item[1])
            : [match[2].slice(1, -1)];
        const line = content.slice(0, match.index).split('\n').length;
        for (const endpointPath of paths) {
            endpoints.push({
                method: match[1].toUpperCase(),
                path: endpointPath,
                auth,
                source: `${relative}:${line}`
            });
        }
    }
}

endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
console.log(JSON.stringify({ count: endpoints.length, endpoints }, null, 2));
