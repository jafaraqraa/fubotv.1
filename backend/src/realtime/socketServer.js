// Dedicated Socket.IO Server Initialization (Task 5)
const { Server } = require('socket.io');
const eventPublisher = require('./eventPublisher');
const { EVENTS } = require('./events');
const app = require('../app');
const { getOriginPolicy } = require('../security/originPolicy');
const runtimeState = require('../runtime/runtimeState');
const { getMemberships } = require('../security/accessControl');
const adminRepo = require('../database/repositories/adminRepository');

let io = null;

function initializeSocketServer(httpServer) {
    if (io) return io;

    const originPolicy = getOriginPolicy();

    io = new Server(httpServer, {
        cors: {
            origin: function (origin, callback) {
                const decision = originPolicy.evaluate(origin, 'Socket.IO');
                callback(decision.allowed ? null : new Error('Origin not allowed'), decision.allowed);
            },
            credentials: originPolicy.credentials,
            methods: originPolicy.methods,
            allowedHeaders: originPolicy.allowedHeaders
        },
        allowRequest: (req, callback) => {
            if (!runtimeState.snapshot().ready) {
                return callback('Server is not ready', false);
            }
            const decision = originPolicy.evaluate(req.headers.origin, 'Socket.IO');
            callback(null, decision.allowed);
        }
    });

    // Optional iframe-development compatibility. Disabled by default because
    // query-string credentials can leak through URLs and access logs.
    io.engine.use((req, res, next) => {
        const url = require('url');
        const parsedUrl = url.parse(req.url, true);
        const sessionId = process.env.ALLOW_SESSION_TOKEN_FALLBACK === 'true'
            ? parsedUrl.query && parsedUrl.query.sessionId
            : null;
        if (sessionId) {
            req.headers.cookie = `connect.sid=${sessionId}`;
        }
        next();
    });

    // 1. Mount express-session directly on the Engine.IO low-level engine (Task 6 & Handshake verification pass)
    io.engine.use(app.sessionMiddleware);

    // 2. Register custom Engine.IO handshake validation to reject unauthenticated requests immediately (Task 7)
    io.engine.use((req, res, next) => {
        const session = req.session;
        const admin = session?.userId ? adminRepo.findAdminById(session.userId) : null;
        const absoluteExpiresAt = Number(session?.absoluteExpiresAt || 0);
        if (admin?.isActive && (!absoluteExpiresAt || absoluteExpiresAt > Date.now())) {
            return next();
        }

        if (session?.userId) session.destroy(() => {});

        // Reject Engine.IO handshake with a standard error
        const err = new Error('unauthorized');
        err.data = { message: 'unauthorized' };
        return next(err);
    });

    // 3. Namespace connection handler
    io.on('connection', (socket) => {
        const session = socket.request.session;
        const admin = session?.userId ? adminRepo.findAdminById(session.userId) : null;
        if (!admin?.isActive) {
            console.warn('⚠️ Rejected socket connection with missing session context.');
            return socket.disconnect(true);
        }

        console.log(`🔌 Secure administrator socket connected: ${session.username} (Socket ID: ${socket.id})`);

        const memberships = getMemberships(session.userId);
        if (!memberships.length) {
            console.warn('⚠️ Rejected socket connection without an active tenant membership.');
            return socket.disconnect(true);
        }

        // Bind validated administrator properties to the socket instance (Task 6)
        socket.admin = {
            userId: admin.id,
            username: admin.username,
            displayName: admin.displayName,
            memberships
        };

        // Database-side account deletion/deactivation must revoke an already-open
        // browser without waiting for its next API request.
        const accountValidationTimer = setInterval(() => {
            const current = adminRepo.findAdminById(socket.admin.userId);
            if (current?.isActive) return;
            socket.emit('auth:revoked', { reason: 'account_removed' });
            socket.request.session?.destroy(() => {});
            socket.disconnect(true);
        }, 5000);
        accountValidationTimer.unref?.();

        for (const membership of memberships) {
            socket.join(`tenant:${membership.tenantId}`);
        }
        if (memberships.some(item => item.role === 'super_admin')) {
            socket.join('system:admins');
        }

        // Emit fallback confirmation signal immediately (Task 22)
        socket.emit(EVENTS.READY, {
            version: 1,
            eventId: `ready_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            occurredAt: new Date().toISOString(),
            data: {
                message: 'Connected to real-time system',
                admin: {
                    username: socket.admin.username,
                    displayName: socket.admin.displayName,
                    tenants: memberships.map(({ tenantId, role }) => ({ tenantId, role }))
                }
            }
        });

        socket.on('disconnect', () => {
            clearInterval(accountValidationTimer);
            console.log(`🔌 Secure administrator socket disconnected: ${session.username}`);
        });
    });

    // Pass Socket.IO server reference to event publisher (Task 11)
    eventPublisher.initialize(io);

    return io;
}

function disconnectAdministrator(userId) {
    if (!io) return;
    for (const socket of io.sockets.sockets.values()) {
        if (socket.admin?.userId === userId) socket.disconnect(true);
    }
}

function getIO() {
    return io;
}

async function closeSocketServer() {
    if (!io) {
        eventPublisher.shutdown();
        return;
    }
    const server = io;
    io = null;
    eventPublisher.shutdown();
    await new Promise(resolve => server.close(() => resolve()));
}

module.exports = {
    initializeSocketServer,
    getIO,
    disconnectAdministrator,
    closeSocketServer
};
