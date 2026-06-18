const jwt = require('jsonwebtoken');

exports.generateToken = (id, tokenVersion = 0) => {
    // Fall back to a short-lived access token if unset — never issue a token with
    // no expiry (jwt.sign treats expiresIn: undefined as "never expires").
    return jwt.sign({ id, tokenVersion }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE || '15m'
    });
};

exports.generateRefreshToken = (id, tokenVersion = 0) => {
    return jwt.sign({ id, tokenVersion }, process.env.REFRESH_TOKEN_SECRET, {
        expiresIn: process.env.REFRESH_TOKEN_EXPIRE || '30d'
    });
};

exports.formatResponse = (success, message, data = null, statusCode = 200) => {
    return {
        success,
        message,
        data,
        statusCode
    };
};

exports.validateEmail = (email) => {
    const re = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
    return re.test(email);
};
