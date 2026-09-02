#!/usr/bin/env node
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const marker = '# FUThing verified daily backup';
const projectRoot = path.resolve(__dirname, '..', '..');
const runner = path.join(__dirname, 'run-scheduled-backup.js');
const log = path.join(projectRoot, 'backend', 'data', 'backups', 'backup.log');
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;

const currentResult = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
const current = currentResult.status === 0 ? currentResult.stdout : '';
const lines = current.split(/\r?\n/).filter(line => line && !line.includes(marker) && line !== 'CRON_TZ=Asia/Jerusalem');
lines.push('CRON_TZ=Asia/Jerusalem');
lines.push(`15 3 * * * cd ${quote(projectRoot)} && ${quote(process.execPath)} ${quote(runner)} >> ${quote(log)} 2>&1 ${marker}`);

const install = spawnSync('crontab', ['-'], {
    input: `${lines.join('\n')}\n`,
    encoding: 'utf8'
});
if (install.status !== 0) {
    process.stderr.write(install.stderr || 'Unable to install backup cron.\n');
    process.exit(install.status || 1);
}
console.log('FUThing daily verified backup installed for 03:15 Asia/Jerusalem.');
