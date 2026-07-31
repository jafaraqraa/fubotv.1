const buckets = new Map();

function clientKey(req) {
    return `${req.ip || req.socket?.remoteAddress || 'unknown'}:${req.session?.userId || 'anonymous'}`;
}

function fixedWindow({ name, limit, windowMs }) {
    return (req, res, next) => {
        const now = Date.now();
        const key = `${name}:${clientKey(req)}`;
        let bucket = buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 0, resetAt: now + windowMs };
            buckets.set(key, bucket);
        }
        bucket.count += 1;
        res.setHeader('RateLimit-Limit', String(limit));
        res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
        res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
        if (bucket.count > limit) {
            res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
            return res.status(429).json({ success: false, error: 'Rate limit exceeded' });
        }
        if (buckets.size > 10000) {
            for (const [entryKey, entry] of buckets) {
                if (entry.resetAt <= now) buckets.delete(entryKey);
            }
        }
        next();
    };
}

const adminApiLimit = fixedWindow({ name: 'admin', limit: 600, windowMs: 60_000 });
const aiLimit = fixedWindow({ name: 'ai', limit: 60, windowMs: 60_000 });
const uploadLimit = fixedWindow({ name: 'upload', limit: 20, windowMs: 60_000 });
const webhookLimit = fixedWindow({ name: 'webhook', limit: 600, windowMs: 60_000 });

module.exports = { fixedWindow, adminApiLimit, aiLimit, uploadLimit, webhookLimit, buckets };
