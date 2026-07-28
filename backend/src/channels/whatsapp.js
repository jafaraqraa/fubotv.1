// whatsapp.js - Backward Compatible Bridge/Facade for default WhatsApp Tenant

const manager = require('./whatsapp-providers/WhatsAppProviderManager');

module.exports = {
    getWaClient: () => {
        const provider = manager.getProvider('default');
        return provider && provider.waClient ? provider.waClient : null;
    },
    getWaStatus: () => {
        const provider = manager.getProvider('default');
        return provider ? provider.getStatus() : "غير متصل";
    },
    setWaStatus: (val) => {
        const provider = manager.getProvider('default');
        if (provider) provider.waStatus = val;
    },
    getLastQrCodeUrl: () => {
        const provider = manager.getProvider('default');
        return provider ? provider.getQrCode() : "";
    },
    setLastQrCodeUrl: (val) => {
        const provider = manager.getProvider('default');
        if (provider) provider.lastQrCodeUrl = val;
    },
    startWhatsApp: () => manager.initializeAll()
};
