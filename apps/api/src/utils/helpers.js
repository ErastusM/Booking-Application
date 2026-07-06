const jwt = require('jsonwebtoken');

exports.generateToken = (id, tokenVersion = 0) => {
    // 7 days by default (spec §4.3): normal reopens within a week skip the
    // refresh round-trip — most of the "login every time" pain. Never issue a
    // token with no expiry (jwt.sign treats expiresIn: undefined as forever);
    // tokenVersion still revokes instantly on logout/password change.
    return jwt.sign({ id, tokenVersion }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE || '7d'
    });
};

exports.generateRefreshToken = (id, tokenVersion = 0, jti) => {
    const payload = { id, tokenVersion };
    if (jti) payload.jti = jti; // token id, tracked per-user for rotation / reuse rejection
    return jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, {
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
