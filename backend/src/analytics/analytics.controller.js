const service = require('./analytics.service');

function getOverview(req, res) {
    try {
        const tenantId = req.tenantId;
        const data = service.getOverview(tenantId);
        res.json({ success: true, overview: data });
    } catch (err) {
        console.error('❌ [AnalyticsController] getOverview failed:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}

function getProviders(req, res) {
    try {
        const tenantId = req.tenantId;
        const data = service.getProviders(tenantId);
        res.json({ success: true, providers: data });
    } catch (err) {
        console.error('❌ [AnalyticsController] getProviders failed:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}

function getModels(req, res) {
    try {
        const tenantId = req.tenantId;
        const data = service.getModels(tenantId);
        res.json({ success: true, models: data });
    } catch (err) {
        console.error('❌ [AnalyticsController] getModels failed:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}

function getHistory(req, res) {
    try {
        const tenantId = req.tenantId;
        const data = service.getHistory(tenantId);
        res.json({ success: true, history: data });
    } catch (err) {
        console.error('❌ [AnalyticsController] getHistory failed:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}

function getLive(req, res) {
    try {
        const tenantId = req.tenantId;
        const data = service.getLive(tenantId);
        res.json({ success: true, live: data });
    } catch (err) {
        console.error('❌ [AnalyticsController] getLive failed:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}

module.exports = {
    getOverview,
    getProviders,
    getModels,
    getHistory,
    getLive
};
