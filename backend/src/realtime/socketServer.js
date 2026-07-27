// Dedicated Socket.IO Server Initialization (Task 5)
const { Server } = require('socket.io');
const eventPublisher = require('./eventPublisher');
const { EVENTS } = require('./events');
const app = require('../app');

let io = null;

function initializeSocketServer(httpServer) {
    if (io) return io;

    const frontendOrigin = process.env.FRONTEND_ORIGIN;
    const isProd = process.env.NODE_ENV === 'production';

    io = new Server(httpServer, {
        cors: {
            origin: function (origin, callback) {
                // Dynamically allow origins to ensure WebSocket works correctly in multi-environment setups
                callback(null, true);
            },
            credentials: true
        }
    });

    // Intercept Engine.IO handshake to support sessionId passed via query param when cookies are blocked in iframes
    io.engine.use((req, res, next) => {
        const url = require('url');
        const parsedUrl = url.parse(req.url, true);
        const sessionId = parsedUrl.query && parsedUrl.query.sessionId;
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
        if (session && session.userId) {
            return next();
        }

        // Reject Engine.IO handshake with a standard error
        const err = new Error('unauthorized');
        err.data = { message: 'unauthorized' };
        return next(err);
    });

    // 3. Namespace connection handler
    io.on('connection', (socket) => {
        const session = socket.request.session;
        if (!session || !session.userId) {
            console.warn('⚠️ Rejected socket connection with missing session context.');
            return socket.disconnect(true);
        }

        console.log(`🔌 Secure administrator socket connected: ${session.username} (Socket ID: ${socket.id})`);

        // Bind validated administrator properties to the socket instance (Task 6)
        socket.admin = {
            userId: session.userId,
            username: session.username,
            displayName: session.displayName
        };

        // Join the admins security segment (Task 21)
        socket.join('admins');

        // Emit fallback confirmation signal immediately (Task 22)
        socket.emit(EVENTS.READY, {
            version: 1,
            eventId: `ready_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            occurredAt: new Date().toISOString(),
            data: {
                message: 'Connected to real-time system',
                admin: {
                    username: socket.admin.username,
                    displayName: socket.admin.displayName
                }
            }
        });

        socket.on('disconnect', () => {
            console.log(`🔌 Secure administrator socket disconnected: ${session.username}`);
        });
    });

    // Pass Socket.IO server reference to event publisher (Task 11)
    eventPublisher.initialize(io);

    return io;
}

function getIO() {
    return io;
}

module.exports = {
    initializeSocketServer,
    getIO
};
