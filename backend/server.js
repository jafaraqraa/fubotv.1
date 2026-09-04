const path = require('path');
const restoreResult = require('./src/services/pendingRestoreService').applyPendingRestore();
if (restoreResult) console.log(JSON.stringify({ level: 'info', event: 'backup_restore_applied', ...restoreResult }));
const {
    installProcessOutputGuards,
    isDetachedOutputError
} = require('./src/config/processOutputSafety');

// A closed terminal/pipe must not be reported as an application failure.
installProcessOutputGuards();
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { validateProductionSecurityConfig } = require('./src/config/securityConfig');
const { initializeDatabase } = require('./src/database/initialize');
const { loadSettingsOnStartup } = require('./src/services/settingsService');
const { bootstrapAdminAccount } = require('./src/services/adminBootstrap');
const runtimeState = require('./src/runtime/runtimeState');

runtimeState.markStarting();

// 1. Initialize SQLite connection and run schema migrations synchronously before starting services
initializeDatabase();

// Load persistent SQLite settings into process.env before starting other services
loadSettingsOnStartup();
validateProductionSecurityConfig();
const ragConfig = require('./src/rag/config/ragConfig');
ragConfig.validateRuntimeConfig();
console.log(JSON.stringify({
    level: 'info',
    event: 'rag_safety_runtime_configuration',
    evidenceGateEnabled: String(ragConfig.getConfig('RAG_EVIDENCE_GATE_ENABLED')).toLowerCase() === 'true',
    groundingSafetyBoundaryEnabled: String(ragConfig.getConfig('RAG_GROUNDING_SAFETY_BOUNDARY_ENABLED')).toLowerCase() === 'true',
    groundingSafetyBoundaryShadow: String(ragConfig.getConfig('RAG_GROUNDING_SAFETY_BOUNDARY_SHADOW')).toLowerCase() === 'true',
    groundingSafetyEnforcementPercent: Number(ragConfig.getConfig('RAG_GROUNDING_SAFETY_ENFORCEMENT_PERCENT'))
}));
require('./src/rag/runtime/distributedLockService').startStaleLeaseRecovery();

// 2. Idempotently bootstrap initial administrator account (Task 6)
bootstrapAdminAccount();

const app = require('./src/app');
const http = require('http');
const httpServer = http.createServer(app);
httpServer.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS) || 120000;
httpServer.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT_MS) || 60000;
httpServer.keepAliveTimeout = Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS) || 5000;

// Initialize real-time Socket.IO server layer
const { initializeSocketServer, closeSocketServer } = require('./src/realtime/socketServer');
initializeSocketServer(httpServer);

const { reportError } = require('./src/services/logger');
const { initializeTelegramOnStartup, stopBot } = require('./src/channels/telegram');
const { startWhatsApp } = require('./src/channels/whatsapp');
const whatsappManager = require('./src/channels/whatsapp-providers/WhatsAppProviderManager');
const { seedExistingKeysOnStartup, syncAllConfiguredApiKeys } = require('./src/services/budgetService');
const db = require('./src/database/connection');

const PORT = process.env.PORT || 3000;

async function startBackgroundServices() {
    // Never initialize external providers until the HTTP port is successfully bound.
    try {
        const telegramStarted = await withTimeout(
            initializeTelegramOnStartup(),
            Number(process.env.TELEGRAM_STARTUP_TIMEOUT_MS) || 15000,
            'Telegram startup'
        );
        if (!telegramStarted) {
            console.warn(JSON.stringify({
                level: 'warn',
                event: 'telegram_startup_degraded',
                message: 'Telegram provider is unavailable'
            }));
        }
    } catch (err) {
        if (!/Telegram startup timed out/i.test(err.message)) {
            await reportError('تهيئة تيليجرام عند بدء الخادم', err.message);
        }
        console.warn(JSON.stringify({
            level: 'warn',
            event: 'telegram_startup_degraded',
            message: err.message
        }));
    }
    try {
        await startWhatsApp();
    } catch (err) {
        reportError("تهيئة بوابات واتساب عند بدء الخادم", err.message);
    }

    try {
        seedExistingKeysOnStartup();
    } catch (err) {
        console.error('⚠️ [Startup] Seeding existing keys failed:', err.message);
    }
    await syncAllConfiguredApiKeys().catch(err => {
        console.error('⚠️ [Startup] Initial API Key sync failed:', err.message);
    });
    require('./src/rag/services/ragReconciliationScheduler').startReconciliationScheduler();
}

let isShuttingDown = false;
let shutdownPromise = null;

function withTimeout(promise, timeoutMs, label) {
    let timer;
    return Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
            timer.unref?.();
        })
    ]).finally(() => clearTimeout(timer));
}

function stopSchedulers() {
    require('./src/rag/services/ragReconciliationScheduler').stopReconciliationScheduler();
    require('./src/rag/runtime/distributedLockService').stopStaleLeaseRecovery();
}

function closeHttpServer(graceMs) {
    if (!httpServer.listening) return Promise.resolve();
    return new Promise(resolve => {
        let settled = false;
        let forceTimer;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(forceTimer);
            resolve();
        };
        httpServer.close(finish);
        httpServer.closeIdleConnections?.();
        forceTimer = setTimeout(() => {
            httpServer.closeAllConnections?.();
            finish();
        }, graceMs);
        forceTimer.unref?.();
    });
}

async function safeReportFatal(type, error) {
    try {
        await withTimeout(
            reportError(type, error?.message || String(error)),
            Number(process.env.FATAL_LOG_TIMEOUT_MS) || 2000,
            'fatal error reporting'
        );
    } catch (_) {
        // stdout/stderr or SQLite may already be unavailable. Never recurse.
    }
}

async function gracefulShutdown(signal, exitCode = 0, cause = null) {
    if (shutdownPromise) return shutdownPromise;
    isShuttingDown = true;
    runtimeState.markShuttingDown(signal);

    shutdownPromise = (async () => {
        const graceMs = Number(process.env.SHUTDOWN_GRACE_MS)
            || Number(require('./src/rag/config/ragConfig').getConfig('RAG_SHUTDOWN_GRACE_MS'))
            || 15000;
        const hardTimeoutMs = Number(process.env.SHUTDOWN_HARD_TIMEOUT_MS) || Math.max(30000, graceMs + 10000);
        const hardTimer = setTimeout(() => {
            console.error(JSON.stringify({
                level: 'fatal',
                event: 'shutdown_timeout',
                signal,
                timeoutMs: hardTimeoutMs
            }));
            process.exit(exitCode || 1);
        }, hardTimeoutMs);

        console.log(JSON.stringify({
            level: cause ? 'fatal' : 'info',
            event: 'shutdown_started',
            signal,
            exitCode,
            message: cause?.message || null
        }));

        stopSchedulers();
        const httpClosePromise = closeHttpServer(graceMs);

        try {
            await withTimeout(
                require('./src/rag/runtime/operationRegistry').beginShutdown(graceMs),
                graceMs,
                'RAG operation drain'
            );
        } catch (e) {
            console.error(JSON.stringify({ level: 'error', event: 'rag_drain_failed', error: e.message }));
        }

        try {
            await withTimeout(closeSocketServer(), 5000, 'Socket.IO shutdown');
        } catch (e) {
            console.error(JSON.stringify({ level: 'error', event: 'socket_shutdown_failed', error: e.message }));
        }

        try {
            await withTimeout(stopBot(signal), 5000, 'Telegram shutdown');
        } catch (e) {
            console.error(JSON.stringify({ level: 'error', event: 'telegram_shutdown_failed', error: e.message }));
        }

        try {
            await withTimeout(whatsappManager.destroyAll(), 10000, 'WhatsApp shutdown');
        } catch (e) {
            console.error(JSON.stringify({ level: 'error', event: 'whatsapp_shutdown_failed', error: e.message }));
        }

        try {
            await withTimeout(httpClosePromise, graceMs + 1000, 'HTTP shutdown');
        } catch (e) {
            httpServer.closeAllConnections?.();
            console.error(JSON.stringify({ level: 'error', event: 'http_shutdown_failed', error: e.message }));
        }

        try {
            if (db.open) db.close();
        } catch (e) {
            console.error(JSON.stringify({ level: 'error', event: 'database_shutdown_failed', error: e.message }));
        }

        console.log(JSON.stringify({ level: 'info', event: 'shutdown_completed', signal, exitCode }));
        clearTimeout(hardTimer);
        process.exitCode = exitCode;
        await new Promise(resolve => setImmediate(resolve));
        process.exit(exitCode);
    })();

    return shutdownPromise;
}

async function handleFatal(type, reason) {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    if (isDetachedOutputError(error)) return;
    await safeReportFatal(type, error);
    await gracefulShutdown(type, 1, error);
}

process.on('uncaughtException', (error) => {
    void handleFatal('UNCAUGHT_EXCEPTION', error);
});
process.on('unhandledRejection', (reason) => {
    void handleFatal('UNHANDLED_REJECTION', reason);
});
process.on('SIGINT', () => void gracefulShutdown('SIGINT', 0));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM', 0));
process.on('fubot:restore-ready', () => void gracefulShutdown('RESTORE_REQUESTED', 75));

function listenHttpServer() {
    return new Promise((resolve, reject) => {
        const onError = error => {
            httpServer.off('listening', onListening);
            reject(error);
        };
        const onListening = () => {
            httpServer.off('error', onError);
            resolve();
        };
        httpServer.once('error', onError);
        httpServer.once('listening', onListening);
        httpServer.listen(PORT);
    });
}

async function startServer() {
    const { assertQdrantTenantOwnershipSafe } = require('./src/rag/security/legacyTenantMigration');
    await assertQdrantTenantOwnershipSafe();
    await listenHttpServer();
    httpServer.on('error', error => void handleFatal('HTTP_SERVER_ERROR', error));
    await startBackgroundServices();
    runtimeState.markReady();
    console.log(JSON.stringify({
        level: 'info',
        event: 'server_ready',
        url: `http://localhost:${PORT}`
    }));
}

startServer().catch(error => {
    console.error(JSON.stringify({ level: 'fatal', event: 'startup_failed', error: error.message }));
    void safeReportFatal('STARTUP_FAILED', error)
        .finally(() => gracefulShutdown('STARTUP_FAILED', 1, error));
});

module.exports = {
    startServer,
    gracefulShutdown,
    handleFatal,
    httpServer
};
