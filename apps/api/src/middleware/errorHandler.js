const pino = require('pino');
const { sendAlert } = require('../utils/alerts');
const log = pino({ level: process.env.LOG_LEVEL || 'info' });

exports.errorHandler = (err, req, res, next) => {
    // Log the PATH only, never the query string — verify-email?token=, oauth ?code=,
    // and password-reset links carry secrets in the query, and this handler has its
    // own pino instance that bypasses the request logger's query-stripping serializer.
    const path = String(req.originalUrl || '').split('?')[0];
    log.error({ err, method: req.method, url: path }, err.message);

    const status = err.statusCode || 500;

    // 5xx = something WE broke — page the webhook (throttled, fire-and-forget).
    if (status >= 500) {
        sendAlert(`500 on ${req.method} ${path}`, err.message).catch(() => {});
    }

    // In production, never leak internal error details to the client
    const message = status < 500 ? (err.message || 'Request error') : 'Internal Server Error';

    res.status(status).json({
        success: false,
        message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

exports.notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    res.status(404);
    next(error);
};
