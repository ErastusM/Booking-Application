const mongoose = require('mongoose');
const pino = require('pino');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,   // fail fast if MongoDB is unreachable
            connectTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            maxPoolSize: 10,
        });

        log.info({ host: conn.connection.host }, 'MongoDB connected');
        return conn;
    } catch (error) {
        log.fatal({ err: error.message }, 'MongoDB connection failed');
        process.exit(1);
    }
};

module.exports = connectDB;
