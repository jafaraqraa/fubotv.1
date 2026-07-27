/**
 * Global prototype pollution guard.
 * Rejects requests containing prototype pollution vectors.
 */
function prototypePollutionGuard(req, res, next) {
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

    function isUnsafe(obj) {
        if (!obj || typeof obj !== 'object') return false;

        for (const key in obj) {
            if (dangerousKeys.includes(key)) {
                return true;
            }
            if (typeof obj[key] === 'object' && isUnsafe(obj[key])) {
                return true;
            }
        }
        return false;
    }

    if (isUnsafe(req.query) || isUnsafe(req.body) || isUnsafe(req.params)) {
        return res.status(400).json({ success: false, error: 'تم رفض الطلب لدواعي أمنية (Prototype Pollution Guard).' });
    }

    if (req.rawBody) {
        const rawString = req.rawBody.toString('utf8');
        for (const key of dangerousKeys) {
            if (rawString.includes(`"${key}"`) || rawString.includes(`'${key}'`)) {
                return res.status(400).json({ success: false, error: 'تم رفض الطلب لدواعي أمنية (Prototype Pollution Guard).' });
            }
        }
    }

    next();
}

module.exports = {
    prototypePollutionGuard
};
