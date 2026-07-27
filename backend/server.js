require('dotenv').config();
const { initializeDatabase } = require('./src/database/initialize');
const { loadSettingsOnStartup } = require('./src/services/settingsService');
const { bootstrapAdminAccount } = require('./src/services/adminBootstrap');

// 1. Initialize SQLite connection and run schema migrations synchronously before starting services
initializeDatabase();

// Load persistent SQLite settings into process.env before starting other services
loadSettingsOnStartup();

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
const { startWhatsApp, getWaClient } = require('./src/channels/whatsapp');
const whatsappManager = require('./src/channels/whatsapp-providers/WhatsAppProviderManager');
const db = require('./src/database/connection');

const PORT = process.env.PORT || 3000;

// بدء تشغيل قنوات تيليجرام وواتساب التلقائي بالخلفية
initializeTelegramOnStartup();
startWhatsApp();

// Run initial background API usage limits sync on startup
const { seedExistingKeysOnStartup, syncAllConfiguredApiKeys } = require('./src/services/budgetService');
try {
    seedExistingKeysOnStartup();
} catch (e) {
    console.error('⚠️ [Startup] Seeding existing keys failed:', e.message);
}
syncAllConfiguredApiKeys().catch(err => {
    console.error('⚠️ [Startup] Initial API Key sync failed:', err.message);
});

// حماية السيرفر من الانهيار عند حدوث أخطاء غير متوقعة بالخلفية
process.on('uncaughtException', (err) => {
    reportError("خطأ داخلي غير متوقع بالخلفية", err.message);
});
process.on('unhandledRejection', (reason, promise) => {
    reportError("وعد برمجي غير معالج (Rejection)", reason.message || String(reason));
});

// Graceful Shutdown handling (Task 18)
let isShuttingDown = false;
async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

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
        db.close();
    } catch (e) {
        console.error('Failed to close database:', e.message);
    }

    console.log('👋 Clean exit. Goodbye!');
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

httpServer.listen(PORT, () => console.log(`🌐 السيرفر يعمل على: http://localhost:${PORT}`));
