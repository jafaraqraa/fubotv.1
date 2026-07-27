const { addLog, saveError, getRecentLogs, listErrors, getActiveErrorsCount, solveError } = require('../database/repositories/logRepository');

let telegramNotifier = null;

function setTelegramNotifier(notifier) {
    telegramNotifier = notifier;
}

async function reportError(type, message) {
    const id = Date.now();
    const time = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const date = new Date().toLocaleDateString('ar-EG');

    // Save to SQLite persistently
    saveError(id, date, time, type, message);

    addLog(`🚨 عطل فني: [${type}]`);
    console.error(`🚨 [${type}] - ${message}`);

    if (telegramNotifier) {
        try {
            await telegramNotifier(type, date, time, message);
        } catch (e) {
            console.error("❌ فشل إرسال تنبيه الإشعارات للمشرف عبر تيليجرام:", e.message);
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
    solveError
};
