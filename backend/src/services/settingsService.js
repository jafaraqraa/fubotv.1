const fs = require('fs');
const path = require('path');
const { saveSetting, getSetting, getAllSettings } = require('../database/repositories/settingsRepository');

const SENSITIVE_KEYS = [
    'BOT_TOKEN',
    'OPENROUTER_API_KEY',
    'MESSENGER_ACCESS_TOKEN',
    'INSTAGRAM_ACCESS_TOKEN',
    'META_VERIFY_TOKEN',
    'META_APP_SECRET',
    'WHATSAPP_APP_SECRET',
    'AI_API_KEY'
];

function parseEnvFile() {
    const envPath = path.join(__dirname, '..', '..', '.env');
    const result = {};
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const parts = trimmed.split('=');
                const key = parts[0].trim();
                const value = parts.slice(1).join('=').trim();
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    result[key] = value.substring(1, value.length - 1);
                } else {
                    result[key] = value;
                }
            }
        }
    }
    return result;
}

function isOverriddenAtRuntime(key, envFileValue) {
    const currentVal = process.env[key];
    if (currentVal === undefined) return false;
    if (envFileValue === undefined) {
        return true;
    }
    return currentVal !== envFileValue;
}

function loadSettingsOnStartup() {
    try {
        const envFile = parseEnvFile();
        const dbSettings = getAllSettings();

        console.log('⚙️ Loading persistent SQLite settings...');

        for (const [key, sqliteValue] of Object.entries(dbSettings)) {
            const fileVal = envFile[key];
            if (isOverriddenAtRuntime(key, fileVal)) {
                console.log(`⚠️ Setting [${key}] is explicitly overridden at runtime. Preserving environment value.`);
            } else {
                process.env[key] = sqliteValue;
            }
        }
    } catch (e) {
        console.error('Failed to load settings on startup:', e.message);
    }
}

function maskSecret(value) {
    if (!value) return "";
    if (value.length <= 8) {
        return "••••••••";
    }
    return "••••••••" + value.substring(value.length - 4);
}

function isMaskedPlaceholder(value) {
    if (!value) return false;
    return value.includes('•') || value.includes('●');
}

module.exports = {
    loadSettingsOnStartup,
    saveSetting,
    getSetting,
    getAllSettings,
    SENSITIVE_KEYS,
    maskSecret,
    isMaskedPlaceholder
};
