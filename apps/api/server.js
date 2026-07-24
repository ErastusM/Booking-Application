require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
const pinoHttp = require('pino-http');
const mongoose = require('mongoose');
const connectDB = require('./src/utils/database');
const { errorHandler, notFound } = require('./src/middleware/errorHandler');

// Routes
const authRoutes = require('./src/routes/authRoutes');
const serviceRoutes = require('./src/routes/serviceRoutes');
const appointmentRoutes = require('./src/routes/appointmentRoutes');
const userRoutes = require('./src/routes/userRoutes');
const waitingListRoutes = require('./src/routes/waitingListRoutes');
const reviewRoutes = require('./src/routes/reviewRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const analyticsRoutes = require('./src/routes/analyticsRoutes');
const availabilityRoutes = require('./src/routes/availabilityRoutes');
const earningsRoutes = require('./src/routes/earningsRoutes');
const categoryRoutes = require('./src/routes/categoryRoutes');
const providerRoutes = require('./src/routes/providerRoutes');
const blockedTimeRoutes = require('./src/routes/blockedTimeRoutes');
const messageRoutes = require('./src/routes/messageRoutes');
const clientCRMRoutes = require('./src/routes/clientCRMRoutes');
const packageRoutes = require('./src/routes/packageRoutes');
const retentionRoutes = require('./src/routes/retentionRoutes');
const teamMemberRoutes = require('./src/routes/teamMemberRoutes');
const suggestionRoutes = require('./src/routes/suggestionRoutes');
const formRoutes = require('./src/routes/formRoutes');
const pushRoutes = require('./src/routes/pushRoutes');
const walletRoutes = require('./src/routes/walletRoutes');
const providerWalletRoutes = require('./src/routes/providerWalletRoutes');
const sitemapRoutes = require('./src/routes/sitemapRoutes');
const clientErrorRoutes = require('./src/routes/clientErrorRoutes');
const eventRoutes = require('./src/routes/eventRoutes');
const startReminderJob = require('./src/utils/reminderService');
const startWalletExpiryJob = require('./src/utils/walletExpiryService');
const startAutoCompleteJob = require('./src/utils/autoCompleteService');
const passport = require('./src/config/passport');
const User = require('./src/models/User');

async function seedAdmin() {
    // Admin credentials must come from the environment — never hardcoded.
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) {
        logger.warn('ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin seed');
        return;
    }
    const existing = await User.findOne({ email });
    if (existing) return;
    await User.create({
        name: process.env.ADMIN_NAME || 'Admin',
        email,
        password,
        phone: process.env.ADMIN_PHONE || '+264000000000',
        role: 'admin',
        isVerified: true,
        provider: 'local',
    });
    logger.info('Admin user seeded');
}

// Fail fast at boot if anything required for secure operation is missing.
function assertRequiredEnv() {
    const required = ['JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'MONGODB_URI'];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) {
        logger.fatal({ missing }, 'Missing required environment variables — refusing to start');
        process.exit(1);
    }
    const weak = ['JWT_SECRET', 'REFRESH_TOKEN_SECRET'].filter((k) => (process.env[k] || '').length < 32);
    if (weak.length && process.env.NODE_ENV === 'production') {
        logger.fatal({ weak }, 'Token secrets are too short for production (need >= 32 chars)');
        process.exit(1);
    }
}

const app = express();

// Trust the first proxy hop (Nginx) so express-rate-limit reads the real
// client IP from X-Forwarded-For instead of the proxy IP. Without this,
// every request appears to come from the same IP and the whole bucket is
// shared across all users.
app.set('trust proxy', 1);

// Structured logger — pretty in dev, JSON in production/test
const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});
module.exports.logger = logger;

// Last-resort visibility: crashes and floating rejections page the alert
// webhook (throttled; no-op without ALERT_WEBHOOK_URL). An uncaught exception
// still exits — docker restarts the container — but now someone KNOWS.
const { sendAlert } = require('./src/utils/alerts');
process.on('unhandledRejection', (reason) => {
    logger.error({ reason: reason?.message || String(reason) }, 'Unhandled promise rejection');
    sendAlert('Unhandled promise rejection', reason?.stack || String(reason)).catch(() => {});
});
process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — exiting for a clean restart');
    sendAlert('Uncaught exception (restarting)', err.stack || err.message)
        .catch(() => {})
        .finally(() => process.exit(1));
});

// Rate limiters — disabled in test environment to prevent 429s during test runs
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'test' ? 10000 : 50,
    message: { success: false, message: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
});

const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10000 : 100,
    message: { success: false, message: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
});

const readLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    // Sized for reality: both apps poll (appointments/blocked-times/messages
    // every 25-30s per open tab) and the bucket is shared per IP across every
    // read route. 300 was exhausted by a single working session.
    max: process.env.NODE_ENV === 'test' ? 10000 : 900,
    message: { success: false, message: 'Too many requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
});

// Method-aware limiter for routers that serve BOTH polling reads and real
// mutations: GETs draw from the (large) read budget, everything else from the
// (small) write budget. Mounting such routers wholesale on writeLimiter was
// the "Failed to load appointments" bug — the dashboard's 25s polling burned
// the shared 100/15min write bucket and every later request 429'd.
const readOrWrite = (req, res, next) =>
    (req.method === 'GET' ? readLimiter : writeLimiter)(req, res, next);

// Middleware
app.use(helmet());
const allowedOrigins = new Set([
    ...(process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',').map(o => o.trim()).filter(Boolean) : []),
    'http://localhost:3000',
    'http://localhost:3001',
    // Epic 1 app shells (customer 3002 / business 3003) in local dev.
    // Production subdomains are added via the comma-separated CLIENT_URL env.
    'http://localhost:3002',
    'http://localhost:3003',
]);

app.use(cors({
    origin: (origin, callback) => {
        // Allow non-browser clients (curl, server-to-server) and configured browser origins.
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(mongoSanitize());
if (process.env.NODE_ENV !== 'test') {
    app.use(pinoHttp({ logger }));
}

// Routes
app.use(passport.initialize());
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/services', readLimiter, serviceRoutes);
app.use('/api/appointments', readOrWrite, appointmentRoutes);
app.use('/api/users', readLimiter, userRoutes);
app.use('/api/waitinglist', readOrWrite, waitingListRoutes);
app.use('/api/reviews', readOrWrite, reviewRoutes);
app.use('/api/notifications', readLimiter, notificationRoutes);
app.use('/api/analytics', readLimiter, analyticsRoutes);
app.use('/api/availability', readLimiter, availabilityRoutes);
app.use('/api/earnings', readLimiter, earningsRoutes);
app.use('/api/categories', readLimiter, categoryRoutes);
app.use('/api/providers', readLimiter, providerRoutes);
app.use('/api/blocked-times', readOrWrite, blockedTimeRoutes);
app.use('/api/messages', readOrWrite, messageRoutes);
app.use('/api/crm', readLimiter, clientCRMRoutes);
app.use('/api/packages', readOrWrite, packageRoutes);
app.use('/api/retention', readLimiter, retentionRoutes);
app.use('/api/team', readOrWrite, teamMemberRoutes);
app.use('/api/suggestions', readOrWrite, suggestionRoutes);
app.use('/api/forms', readOrWrite, formRoutes);
app.use('/api/push', readOrWrite, pushRoutes);
app.use('/api/wallet', readOrWrite, walletRoutes);
app.use('/api/provider-wallet', readOrWrite, providerWalletRoutes);
// SEO — dynamic sitemap + robots.txt (nginx maps www.bookplus.pro/{sitemap.xml,robots.txt} here).
app.use('/api/seo', readLimiter, sitemapRoutes);
// Frontend crash reporting sink (own hard rate limit inside the router).
app.use('/api/client-errors', clientErrorRoutes);
// Product-analytics event pipe (own rate limit + optional auth inside the router).
app.use('/api/events', eventRoutes);


// Health check — includes DB connectivity
app.get('/api/health', async (req, res) => {
    const dbState = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    const status = dbState === 'connected' ? 200 : 503;
    res.status(status).json({
        success: dbState === 'connected',
        db: dbState,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
    });
});

// Error handling
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Only bind and start the cron job when run directly (not imported by tests)
if (require.main === module) {
    assertRequiredEnv();
    connectDB().then(async () => {
        await seedAdmin();
        // Account-type migration on boot (idempotent): backfills accountType and,
        // crucially, DROPS the legacy global-unique `email_1` index. Without this
        // an old production DB keeps that index and rejects the SECOND account
        // (e.g. a customer account for an email that already has a business one)
        // even though the app logic allows it. Running it here — inside the app
        // container, every boot — guarantees it, rather than relying on the
        // deploy's best-effort `docker compose exec ... || true` step.
        try {
            const { migrateAccountTypes } = require('./scripts/migrate_account_types');
            const { backfilled, droppedOldIndex } = await migrateAccountTypes();
            logger.info({ backfilled, droppedOldIndex }, 'Account-type migration ensured on boot');
        } catch (err) {
            logger.error({ err: err.message }, 'Account-type boot migration failed (non-fatal)');
        }
        // Give every provider a unique public booking-link slug (idempotent).
        try {
            const { backfillSlugs } = require('./scripts/backfill_slugs');
            const { assigned } = await backfillSlugs();
            logger.info({ assigned }, 'Booking-link slugs ensured on boot');
        } catch (err) {
            logger.error({ err: err.message }, 'Slug backfill failed (non-fatal)');
        }
        // Mark PRE-EXISTING waitlist promotions as already celebrated so the new
        // "a slot opened up!" moment doesn't fire retroactively for old bookings on
        // first deploy. Idempotent — after the first run there are no unset fields.
        try {
            const WaitingList = require('./src/models/WaitingList');
            const { modifiedCount } = await WaitingList.updateMany(
                { status: 'promoted', celebrated: { $exists: false } },
                { $set: { celebrated: true } }
            );
            logger.info({ modifiedCount }, 'Waitlist promotions backfilled (celebrated)');
        } catch (err) {
            logger.error({ err: err.message }, 'Waitlist celebrated backfill failed (non-fatal)');
        }
        // Retire the old 24h cancellation window. Accounts created under the previous
        // schema have 24 PERSISTED, so changing the schema default alone would leave
        // them enforcing it — clients still blocked from cancelling, slot never
        // released to the waiting list. Only the old default value is cleared, so a
        // provider who deliberately picks a window later keeps it. Idempotent.
        try {
            const User = require('./src/models/User');
            const { modifiedCount } = await User.updateMany(
                { 'bookingPolicy.cancellationWindowHours': 24 },
                { $set: { 'bookingPolicy.cancellationWindowHours': 0 } }
            );
            logger.info({ modifiedCount }, 'Legacy 24h cancellation window cleared');
        } catch (err) {
            logger.error({ err: err.message }, 'Cancellation-window reset failed (non-fatal)');
        }
        const server = app.listen(PORT, () => {
            logger.info({ port: PORT }, 'Server running');
            startReminderJob();
            startWalletExpiryJob();
            startAutoCompleteJob();
        });

        const shutdown = async (signal) => {
            logger.info({ signal }, 'Shutdown signal received — closing gracefully');
            server.close(async () => {
                await mongoose.connection.close();
                logger.info('MongoDB connection closed');
                process.exit(0);
            });
            // Force exit if graceful close takes too long
            setTimeout(() => {
                logger.error('Graceful shutdown timed out — forcing exit');
                process.exit(1);
            }, 10000).unref();
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT',  () => shutdown('SIGINT'));
    });
}

module.exports = app;
