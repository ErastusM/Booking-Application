const pino = require('pino');
const { sendAlert } = require('../utils/alerts');
const log = pino({ level: process.env.LOG_LEVEL || 'info' });

exports.errorHandler = (err, req, res, next) => {
    // Log the PATH only, never the query string — verify-email?token=, oauth ?code=,
    // and password-reset links carry secrets in the query, and this handler has its
    // own pino instance that bypasses the request logger's query-stripping serializer.
    const path = String(req.originalUrl || '').split('?')[0];
    const status = err.statusCode || 500;
    // A 4xx is the caller's problem: keep it out of the error log's signal.
    if (status >= 500) log.error({ err, method: req.method, url: path }, err.message);
    else log.warn({ method: req.method, url: path, status }, err.message);

    // 5xx = something WE broke — page the webhook (throttled, fire-and-forget).
    if (status >= 500) {
        res.locals.errorReported = true; // server.js reports the other 5xx answers
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

// An unknown address is the caller's mistake, not ours: answer 404 (the error
// handler reads statusCode, so without it this was a 500 that also paged the
// alert webhook). The path only, never the query string, which can hold tokens.
exports.notFound = (req, res, next) => {
    const path = String(req.originalUrl || '').split('?')[0];
    const error = new Error(`Not Found - ${path}`);
    error.statusCode = 404;
    next(error);
};
