const path = require('path');
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

// 1. Initialize SQLite connection and run schema migrations synchronously before starting services
initializeDatabase();

// Load persistent SQLite settings into process.env before starting other services
loadSettingsOnStartup();
validateProductionSecurityConfig();
require('./src/rag/config/ragConfig').validateRuntimeConfig();
require('./src/rag/runtime/distributedLockService').startStaleLeaseRecovery();

// 2. Idempotently bootstrap initial administrator account (Task 6)
bootstrapAdminAccount();

const app = require('./src/app');
const http = require('http');
const httpServer = http.createServer(app);

// Initialize real-time Socket.IO server layer
const { initializeSocketServer } = require('./src/realtime/socketServer');
initializeSocketServer(httpServer);

const { reportError } = require('./src/services/logger');
const { initializeTelegramOnStartup, getBot } = require('./src/channels/telegram');
const { startWhatsApp } = require('./src/channels/whatsapp');
const whatsappManager = require('./src/channels/whatsapp-providers/WhatsAppProviderManager');
const { seedExistingKeysOnStartup, syncAllConfiguredApiKeys } = require('./src/services/budgetService');
const db = require('./src/database/connection');

const PORT = process.env.PORT || 3000;

async function startBackgroundServices() {
    // Never initialize external providers until the HTTP port is successfully bound.
    initializeTelegramOnStartup();
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

// حماية السيرفر من الانهيار عند حدوث أخطاء غير متوقعة بالخلفية
process.on('uncaughtException', (err) => {
    if (isDetachedOutputError(err)) return;
    void reportError("خطأ داخلي غير متوقع بالخلفية", err.message);
});
process.on('unhandledRejection', (reason, promise) => {
    if (isDetachedOutputError(reason)) return;
    void reportError("وعد برمجي غير معالج (Rejection)", reason.message || String(reason));
});

// Graceful Shutdown handling (Task 18)
let isShuttingDown = false;
async function gracefulShutdown(signal, exitCode = 0) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
    try {
        const { getConfig } = require('./src/rag/config/ragConfig');
        const graceMs = Number(getConfig('RAG_SHUTDOWN_GRACE_MS')) || 15000;
        console.log(`🔌 Draining active RAG operations (graceMs=${graceMs})...`);
        await require('./src/rag/runtime/operationRegistry').beginShutdown(graceMs);
    } catch (e) {
        console.error('Failed to drain active RAG operations:', e.message);
    }

    // 1. Stop Telegram Bot if active
    const bot = getBot();
    if (bot) {
        try {
            console.log('🔌 Stopping Telegram Bot...');
            await bot.stop('SIGTERM');
        } catch (e) {
            console.error('Failed to stop Telegram bot:', e.message);
        }
    }

    // 2. Stop all WhatsApp Provider Manager instances safely (Task 18)
    try {
        console.log('🔌 Stopping all WhatsApp Provider Manager instances...');
        await whatsappManager.destroyAll();
    } catch (e) {
        console.error('Failed to destroy WhatsApp Provider Manager:', e.message);
    }

    // 3. Close SQLite Connection safely
    try {
        console.log('🔌 Closing SQLite database connection...');
        require('./src/rag/services/ragReconciliationScheduler').stopReconciliationScheduler();
        require('./src/rag/runtime/distributedLockService').stopStaleLeaseRecovery();
        db.close();
    } catch (e) {
        console.error('Failed to close database:', e.message);
    }

    console.log('👋 Clean exit. Goodbye!');
    process.exit(exitCode);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use. Background services were not started.`);
    } else {
        console.error('❌ HTTP server failed to start:', err.message);
    }
    gracefulShutdown('HTTP_SERVER_ERROR', 1);
});

async function startServer() {
    const { assertQdrantTenantOwnershipSafe } = require('./src/rag/security/legacyTenantMigration');
    await assertQdrantTenantOwnershipSafe();
    httpServer.listen(PORT, () => {
        console.log(`🌐 السيرفر يعمل على: http://localhost:${PORT}`);
        startBackgroundServices().catch(err => {
            reportError('تشغيل خدمات الخلفية بعد بدء HTTP', err.message);
        });
    });
}

startServer().catch(error => {
    console.error(`❌ Startup blocked: ${error.message}`);
    gracefulShutdown('RAG_TENANT_AUDIT_FAILED', 1);
});
