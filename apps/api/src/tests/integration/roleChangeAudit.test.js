/**
 * Make admin / Remove admin (PUT /api/users/:id/role) are written to the audit
 * log as 'security.role_change': who made the change, for which account, and
 * old → new role. An admin granted with a forged session (the leaked
 * JWT_SECRET case in docs/ROTATING_SECRETS.md) then shows up in Settings →
 * Audit log. A refused change writes nothing, and a change that can't be
 * recorded doesn't happen.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const User = require('../../models/User');
const FinancialAuditLog = require('../../models/FinancialAuditLog');
const {
    makeUser, makeProvider, makeAdmin, authHeader, financeHeader,
} = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.restoreAllMocks(); });

const setRole = (actor, target, role) => request(app).put(`/api/users/${target._id}/role`).set(authHeader(actor)).send({ role });
const roleChanges = () => FinancialAuditLog.find({ action: 'security.role_change' }).sort({ _id: 1 }).lean();

describe('role changes are audited', () => {
    it('Make admin and Remove admin each write one entry with the actor and the account', async () => {
        const director = await makeAdmin({ adminRoles: ['director'] });
        const provider = await makeProvider({ email: 'vido@barber.test' });

        expect((await setRole(director, provider, 'admin')).status).toBe(200);
        let log = await roleChanges();
        expect(log).toHaveLength(1);
        expect(String(log[0].actor)).toBe(String(director._id));
        expect(log[0]).toMatchObject({
            actorRole: 'director', reference: 'vido@barber.test', reason: 'provider → admin',
            details: { from: 'provider', to: 'admin' },
        });
        expect(String(log[0].details.user)).toBe(String(provider._id));

        expect((await setRole(director, provider, 'provider')).status).toBe(200);
        log = await roleChanges();
        expect(log).toHaveLength(2);
        expect(String(log[1].actor)).toBe(String(director._id));
        expect(log[1]).toMatchObject({ reference: 'vido@barber.test', reason: 'admin → provider' });

        // Settings → Audit log lists them, newest first, with who did it.
        const list = await request(app).get('/api/admin/finance/audit').set(financeHeader(director));
        expect(list.status).toBe(200);
        expect(list.body.data.map((r) => r.reason)).toEqual(['admin → provider', 'provider → admin']);
        expect(list.body.data[0]).toMatchObject({ action: 'security.role_change', actor: { email: director.email } });
    });

    it('other role changes are recorded too', async () => {
        const admin = await makeAdmin();
        const customer = await makeUser({ email: 'cara@client.test' });
        expect((await setRole(admin, customer, 'provider')).status).toBe(200);
        const log = await roleChanges();
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({ reference: 'cara@client.test', reason: 'customer → provider' });
    });

    it('a refused change writes nothing', async () => {
        const admin = await makeAdmin();
        const { _id: owner } = await makeProvider();
        const staff = await makeUser({ role: 'staff', staffOf: owner });
        const customer = await makeUser();

        expect((await setRole(admin, admin, 'customer')).body.code).toBe('role_self');
        expect((await setRole(admin, staff, 'admin')).body.code).toBe('role_team_login');
        expect((await setRole(admin, customer, 'customer')).status).toBe(400);
        expect((await setRole(admin, customer, 'owner')).status).toBe(400);
        expect(await roleChanges()).toHaveLength(0);
    });

    it('a change that can\'t be recorded doesn\'t happen', async () => {
        const admin = await makeAdmin();
        const customer = await makeUser();
        jest.spyOn(FinancialAuditLog, 'create').mockRejectedValueOnce(new Error('audit write failed'));

        const res = await setRole(admin, customer, 'admin');
        expect(res.status).toBe(500);
        const after = await User.findById(customer._id).lean();
        expect(after.role).toBe('customer');
        expect(after.tokenVersion || 0).toBe(customer.tokenVersion || 0);
    });
});
