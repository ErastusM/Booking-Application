/**
 * Unit tests for JWT helpers and email validation.
 * These run without any DB or HTTP — pure logic.
 */
const jwt = require('jsonwebtoken');
const { generateToken, generateRefreshToken, validateEmail } = require('../../utils/helpers');

describe('generateToken', () => {
    it('returns a valid JWT signed with JWT_SECRET', () => {
        const id = 'user123';
        const token = generateToken(id, 0);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        expect(decoded.id).toBe(id);
        expect(decoded.tokenVersion).toBe(0);
    });

    it('embeds the correct tokenVersion', () => {
        const token = generateToken('abc', 3);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        expect(decoded.tokenVersion).toBe(3);
    });

    it('token expires per JWT_EXPIRE env var', () => {
        const token = generateToken('abc', 0);
        const decoded = jwt.decode(token);
        const expiresInDays = (decoded.exp - decoded.iat) / 86400;
        expect(expiresInDays).toBeCloseTo(7, 0);
    });
});

describe('generateRefreshToken', () => {
    it('signs with REFRESH_TOKEN_SECRET', () => {
        const token = generateRefreshToken('user456');
        const decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
        expect(decoded.id).toBe('user456');
    });

    it('does NOT verify against JWT_SECRET (separate key)', () => {
        const token = generateRefreshToken('user456');
        expect(() => jwt.verify(token, process.env.JWT_SECRET)).toThrow();
    });
});

describe('validateEmail', () => {
    it('accepts valid emails', () => {
        expect(validateEmail('user@example.com')).toBe(true);
        expect(validateEmail('user.name@sub.domain.co')).toBe(true);
    });

    it('rejects invalid emails', () => {
        expect(validateEmail('notanemail')).toBe(false);
        expect(validateEmail('missing@tld')).toBe(false);
        expect(validateEmail('')).toBe(false);
        expect(validateEmail('@nodomain.com')).toBe(false);
    });
});
