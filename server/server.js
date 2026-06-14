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
const startReminderJob = require('./src/utils/reminderService');
const passport = require('./src/config/passport');
const User = require('./src/models/User');

async function seedAdmin() {
    const email = 'bookplusdigitalsolutions@gmail.com';
    const existing = await User.findOne({ email });
    if (existing) return;
    await User.create({
        name: 'Admin',
        email,
        password: 'MosesHam@1999',
        phone: '+264000000000',
        role: 'admin',
        isVerified: true,
        provider: 'local',
    });
    logger.info('Admin user seeded');
}

const app = express();

// Structured logger — pretty in dev, JSON in production/test
const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});
module.exports.logger = logger;

// Rate limiters — disabled in test environment to prevent 429s during test runs
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'test' ? 10000 : 20,
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
    max: process.env.NODE_ENV === 'test' ? 10000 : 300,
    message: { success: false, message: 'Too many requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
});

// Middleware
app.use(helmet());
const allowedOrigins = new Set([
    ...(process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',').map(o => o.trim()).filter(Boolean) : []),
    'http://localhost:3000',
    'http://localhost:3001',
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
app.use('/api/appointments', writeLimiter, appointmentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/waitinglist', writeLimiter, waitingListRoutes);
app.use('/api/reviews', writeLimiter, reviewRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/earnings', earningsRoutes);
app.use('/api/categories', readLimiter, categoryRoutes);
app.use('/api/providers', readLimiter, providerRoutes);
app.use('/api/blocked-times', blockedTimeRoutes);
app.use('/api/messages', writeLimiter, messageRoutes);
app.use('/api/crm', clientCRMRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/retention', retentionRoutes);
app.use('/api/team', teamMemberRoutes);
app.use('/api/suggestions', writeLimiter, suggestionRoutes);


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
    connectDB().then(async () => {
        await seedAdmin();
        const server = app.listen(PORT, () => {
            logger.info({ port: PORT }, 'Server running');
            startReminderJob();
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
