const budgetService = require('../services/budgetService');

async function getBalance(req, res) {
    const provider = String(req.body.provider || '').toLowerCase().trim();
    const forceRefresh = req.body.forceRefresh === true;
    console.log(`[Balance Controller] Provider before BudgetService: ${provider}`);

    try {
        const balance = await budgetService.getProviderBalance(provider, forceRefresh);
        return res.json({ success: balance.success, provider, balance });
    } catch (err) {
        return res.status(400).json({
            success: false,
            provider,
            error: err.message,
            balance: null
        });
    }
}

module.exports = { getBalance };
