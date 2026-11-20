/**
 * optionalAuth + refuseStaleSession: an expired session token on a booking is
 * answered with 401 (the app renews the session and retries), not booked as a
 * guest. No token, or a malformed one, is still a guest.
 */
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const { optionalAuth, refuseStaleSession } = require('../../middleware/auth');

const run = async (authorization) => {
    const req = { headers: authorization ? { authorization } : {}, originalUrl: '/api/appointments', method: 'POST' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    await optionalAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    const after = jest.fn();
    refuseStaleSession(req, res, after);
    return { req, res, passed: after.mock.calls.length === 1 };
};

describe('optionalAuth → refuseStaleSession', () => {
    it('no token: a guest, the booking goes ahead', async () => {
        const { req, passed } = await run();
        expect(req.user).toBeNull();
        expect(passed).toBe(true);
    });

    it('an expired session token: 401 session_expired so the app renews it', async () => {
        const expired = jwt.sign({ id: '0123456789abcdef01234567', tokenVersion: 0, iat: Math.floor(Date.now() / 1000) - 3600 },
            process.env.JWT_SECRET, { expiresIn: '15m' });
        const { req, res, passed } = await run(`Bearer ${expired}`);
        expect(req.user).toBeNull();
        expect(passed).toBe(false);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'session_expired' }));
    });

    it('a malformed token: still a guest (nothing to renew)', async () => {
        const { req, passed } = await run('Bearer not-a-token');
        expect(req.user).toBeNull();
        expect(passed).toBe(true);
    });
});
