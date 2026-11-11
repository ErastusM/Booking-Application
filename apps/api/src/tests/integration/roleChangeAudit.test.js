/**
 * Role changes (PUT /api/users/:id/role) in the audit log, as
 * 'security.role_change' — the cases adminPanel.test.js (4 · Make / Remove
 * admin) doesn't cover: Settings → Audit log lists them with who did it, every
 * role change is recorded (not only admin), no refusal writes an entry, and a
 * change that can't be recorded doesn't happen. An admin granted with a forged
 * session (the leaked JWT_SECRET case in docs/ROTATING_SECRETS.md) then shows
 * up in the log.
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

describe('role changes in the audit log', () => {
    it('Settings → Audit log lists Make admin and Remove admin, newest first, with who did it', async () => {
        const director = await makeAdmin({ adminRoles: ['director'] });
        const provider = await makeProvider({ email: 'vido@barber.test' });
        expect((await setRole(director, provider, 'admin')).status).toBe(200);
        expect((await setRole(director, provider, 'provider')).status).toBe(200);

        const list = await request(app).get('/api/admin/finance/audit').set(financeHeader(director));
        expect(list.status).toBe(200);
        const rows = list.body.data.filter((r) => r.action === 'security.role_change');
        expect(rows.map((r) => r.reason)).toEqual(['admin → provider', 'provider → admin']);
        for (const r of rows) {
            expect(r).toMatchObject({ actorRole: 'director', reference: 'vido@barber.test', actor: { email: director.email } });
        }
    });

    it('a role change that isn\'t about admin is recorded too', async () => {
        const admin = await makeAdmin();
        const customer = await makeUser({ email: 'cara@client.test' });
        expect((await setRole(admin, customer, 'provider')).status).toBe(200);
        const log = await roleChanges();
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({
            reference: 'cara@client.test', reason: 'customer → provider',
            details: { userId: String(customer._id), from: 'customer', to: 'provider' },
        });
    });

    it('no refusal writes an entry', async () => {
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
