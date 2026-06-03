require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
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
const paymentRoutes = require('./src/routes/paymentRoutes');
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
const startReminderJob = require('./src/utils/reminderService');
const passport = require('./src/config/passport');

const app = express();

// Rate limiters — disabled in test environment to prevent 429s during test runs
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'test' ? 10000 : 20,
    message: { success: false, message: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
});

// Middleware
app.use(helmet());
app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3001',
    credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(mongoSanitize());

// Routes
app.use(passport.initialize());
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/waitinglist', waitingListRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/earnings', earningsRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/blocked-times', blockedTimeRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/crm', clientCRMRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/retention', retentionRoutes);


// Health check
app.get('/api/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Server is running'
    });
});

// Error handling
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Only bind and start the cron job when run directly (not imported by tests)
if (require.main === module) {
    connectDB().then(() => {
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            startReminderJob();
        });
    });
}

module.exports = app;

module.exports = app;
