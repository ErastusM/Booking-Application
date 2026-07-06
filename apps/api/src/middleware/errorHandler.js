const pino = require('pino');
const log = pino({ level: process.env.LOG_LEVEL || 'info' });

exports.errorHandler = (err, req, res, next) => {
    log.error({ err, method: req.method, url: req.originalUrl }, err.message);

    const status = err.statusCode || 500;

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
