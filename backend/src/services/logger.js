const { addLog, saveError, getRecentLogs, listErrors, getActiveErrorsCount, solveError } = require('../database/repositories/logRepository');

let telegramNotifier = null;

function redact(value) {
    return String(value || 'Unknown error')
        .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
        .replace(/\b(?:sk|AIza|xox[baprs])-?[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
        .replace(/(["']?(?:token|secret|api[_-]?key|password)["']?\s*[:=]\s*)["']?[^,\s}"']+/gi, '$1[REDACTED]');
}

function setTelegramNotifier(notifier) {
    telegramNotifier = notifier;
}

async function reportError(type, message) {
    const safeType = redact(type);
    const safeMessage = redact(message);
    const id = Date.now();
    const time = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const date = new Date().toLocaleDateString('ar-EG');

    try {
        saveError(id, date, time, safeType, safeMessage);
    } catch (_) {
        // Error reporting must never become a second fatal error.
    }
    try {
        addLog(`🚨 عطل فني: [${safeType}]`);
    } catch (_) {}
    try {
        console.error(JSON.stringify({
            level: 'error',
            event: 'application_error',
            type: safeType,
            message: safeMessage
        }));
    } catch (_) {}

    if (telegramNotifier) {
        try {
            let timer;
            await Promise.race([
                telegramNotifier(safeType, date, time, safeMessage),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('notification timeout')), 2000);
                    timer.unref?.();
                })
            ]).finally(() => clearTimeout(timer));
        } catch (e) {
            try {
                console.error(JSON.stringify({
                    level: 'error',
                    event: 'error_notification_failed',
                    error: e.message
                }));
            } catch (_) {}
        }
    }
}

module.exports = {
    addLog,
    reportError,
    setTelegramNotifier,
    getRecentLogs,
    listErrors,
    getActiveErrorsCount,
    solveError,
    redact
};
