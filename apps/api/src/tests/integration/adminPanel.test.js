/**
 * The admin console's fixes (business app /bkplus-command):
 *   1. Delete user — never yourself or an admin; a business is cleaned up
 *      (nothing left public, upcoming bookings cancelled with no email) and a
 *      client's bookings keep their name.
 *   2. Suspending a business hides it from every public surface and refuses new
 *      bookings; reactivating brings it back.
 *   3. Appointments: the No-show filter, the Business column for admins.
 *   4. Make / Remove admin rules.
 *   5. Wallet credit for a business with no account row yet.
 *   6. One definition of "users" across the admin counts.
 *   7. The Staff role filter.
 * Plus the read-only deploy report scripts/report_orphans.js.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => {
    const actual = jest.requireActual('../../utils/emailService');
    return Object.fromEntries(Object.entries(actual).map(([k, v]) => [k, typeof v === 'function' ? jest.fn().mockResolvedValue(true) : v]));
});

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const emailService = require('../../utils/emailService');
const {
    makeUser, makeProvider, makeAdmin, makeService, makeAppointment, authHeader, giveHours,
} = require('../helpers/factories');
const User = require('../../models/User');
const Service = require('../../models/Service');
const Appointment = require('../../models/Appointment');
const TeamMember = require('../../models/TeamMember');
const Availability = require('../../models/Availability');
const BlockedTime = require('../../models/BlockedTime');
const Notification = require('../../models/Notification');
const ProviderWallet = require('../../models/ProviderWallet');
const { findOrphans, report } = require('../../../scripts/report_orphans');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// A weekday a few days out (future, clear of any past-slot check).
const soon = () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return ymd(d);
};
const daysFromNow = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const anyEmailSent = () => Object.values(emailService).some((fn) => typeof fn === 'function' && fn.mock && fn.mock.calls.length > 0);

const openBusiness = async (overrides = {}) => {
    const provider = await makeProvider({ businessProfile: { businessName: overrides.businessName || 'Vido Barber', slug: overrides.slug || null } });
    const svc = await makeService(provider._id, { name: 'Fade' });
    const open = { enabled: true, slots: [{ start: '08:00', end: '18:00' }] };
    await Availability.create({
        provider: provider._id,
        schedule: { monday: open, tuesday: open, wednesday: open, thursday: open, friday: open, saturday: open, sunday: open },
    });
    return { provider, svc };
};

const guestBooking = (svc, extra = {}) => request(app).post('/api/appointments').send({
    service: String(svc._id), appointmentDate: soon(), startTime: '10:00', endTime: '10:30',
    guestName: 'Jane Doe', guestEmail: 'jane@example.com', startTime: '14:00', endTime: '14:30', ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('1 · Delete user', () => {
    it('refuses deleting yourself and deleting any admin', async () => {
        const admin = await makeAdmin();
        const other = await makeAdmin();
        const self = await request(app).delete(`/api/users/${admin._id}`).set(authHeader(admin));
        expect(self.status).toBe(400);
        expect(self.body.message).toMatch(/own account/i);
        const adm = await request(app).delete(`/api/users/${other._id}`).set(authHeader(admin));
        expect(adm.status).toBe(403);
        expect(adm.body.message).toMatch(/admin/i);
        expect(await User.countDocuments({ role: 'admin' })).toBe(2);
    });

    it('refuses deleting a team member login (their business removes it)', async () => {
        const admin = await makeAdmin();
        const { provider } = await openBusiness();
        const staff = await makeUser({ role: 'staff', staffOf: provider._id });
        const res = await request(app).delete(`/api/users/${staff._id}`).set(authHeader(admin));
        expect(res.status).toBe(400);
        expect(await User.exists({ _id: staff._id })).toBeTruthy();
    });

    it('deleting a business: nothing stays public, upcoming bookings are cancelled without email', async () => {
        const admin = await makeAdmin();
        const { provider, svc } = await openBusiness({ slug: 'vido-barber' });
        const client = await makeUser({ name: 'Maria Shikongo' });
        const member = await TeamMember.create({ provider: provider._id, name: 'Erastus', role: 'Barber' });
        const staffLogin = await makeUser({ role: 'staff', staffOf: provider._id, email: 'staff@vido.test' });
        await BlockedTime.create({ provider: provider._id, date: soon(), startTime: '12:00', endTime: '13:00' });
        const upcoming = await makeAppointment(client._id, svc._id, provider._id, { status: 'confirmed', appointmentDate: daysFromNow(4) });
        const past = await makeAppointment(client._id, svc._id, provider._id, { status: 'completed', appointmentDate: daysFromNow(-10) });
        await User.updateOne({ _id: client._id }, { $push: { favorites: provider._id } });
        // A second, untouched business.
        const other = await openBusiness({ businessName: 'Other Shop' });

        const res = await request(app).delete(`/api/users/${provider._id}`).set(authHeader(admin));
        expect(res.status).toBe(200);
        expect(res.body.data.cancelled).toBe(1);

        expect(await User.exists({ _id: provider._id })).toBeFalsy();
        expect(await User.exists({ _id: staffLogin._id })).toBeFalsy();
        expect(await TeamMember.exists({ _id: member._id })).toBeFalsy();
        expect(await Availability.exists({ provider: provider._id })).toBeFalsy();
        expect(await BlockedTime.exists({ provider: provider._id })).toBeFalsy();
        expect((await Service.findById(svc._id)).isActive).toBe(false);

        const up = await Appointment.findById(upcoming._id);
        expect(up.status).toBe('cancelled');
        expect(up.cancellationReason).toBe('Business removed');
        expect((await Appointment.findById(past._id)).status).toBe('completed');
        // The client is told in the app; no email is sent.
        expect(await Notification.exists({ user: client._id, message: /no longer on Bookplus/ })).toBeTruthy();
        expect(anyEmailSent()).toBe(false);
        expect((await User.findById(client._id)).favorites).toHaveLength(0);

        // Nothing public shows it.
        const services = await request(app).get('/api/services');
        expect(services.body.data.map((s) => String(s._id))).not.toContain(String(svc._id));
        expect(services.body.data.map((s) => String(s._id))).toContain(String(other.svc._id));
        const listing = await request(app).get('/api/providers');
        expect(listing.body.data.map((p) => String(p._id))).toEqual([String(other.provider._id)]);
        expect((await request(app).get('/api/providers/by-slug/vido-barber')).status).toBe(404);
    });

    it('a service whose business account is gone is never served as a global service, nor bookable', async () => {
        // The shape earlier deletes left behind: the User row removed, nothing else.
        const { provider, svc } = await openBusiness();
        const admin = await makeAdmin();
        const global = await Service.create({ name: 'Global Consult', description: 'x', price: 10, duration: 30, provider: null, createdBy: admin._id });
        await User.deleteOne({ _id: provider._id });
        const res = await request(app).get('/api/services');
        const ids = res.body.data.map((s) => String(s._id));
        expect(ids).not.toContain(String(svc._id));
        expect(ids).toContain(String(global._id)); // a real admin global stays
        const book = await guestBooking(svc);
        expect(book.status).toBe(403);
        expect(book.body.code).toBe('provider_unavailable');
    });

    it('deleting a client keeps their name on every booking (owner calendar + admin table)', async () => {
        const admin = await makeAdmin();
        const { provider, svc } = await openBusiness();
        const client = await makeUser({ name: 'Maria Shikongo', email: 'maria@private.test', phone: '+264811111111' });
        const a1 = await makeAppointment(client._id, svc._id, provider._id, { status: 'confirmed' });
        const a2 = await makeAppointment(client._id, svc._id, provider._id, { status: 'completed', appointmentDate: daysFromNow(-5) });

        const res = await request(app).delete(`/api/users/${client._id}`).set(authHeader(admin));
        expect(res.status).toBe(200);
        expect(await User.exists({ _id: client._id })).toBeFalsy();
        for (const id of [a1._id, a2._id]) {
            const a = await Appointment.findById(id).lean();
            expect(a.customer).toBeNull();
            expect(a.walkInName).toBe('Maria Shikongo');
            expect(a.clientAccountDeletedAt).toBeTruthy();
            expect(a.guestEmail).toBeNull();
            expect(a.guestPhone).toBeNull();
        }
        // Statuses are left alone.
        expect((await Appointment.findById(a1._id)).status).toBe('confirmed');
        // The owner's calendar feed and the admin table both carry the name.
        const owner = await request(app).get('/api/appointments?all=true').set(authHeader(provider));
        expect(owner.body.data.every((a) => a.walkInName === 'Maria Shikongo')).toBe(true);
        const adminList = await request(app).get('/api/appointments').set(authHeader(admin));
        expect(adminList.body.data.every((a) => a.walkInName === 'Maria Shikongo')).toBe(true);
        expect(anyEmailSent()).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2 · Suspended business disappears everywhere, and comes back', () => {
    it('hidden from listing, profile, slug, search, services, staff; bookings refused; existing kept', async () => {
        const admin = await makeAdmin();
        const { provider, svc } = await openBusiness({ slug: 'suspend-me' });
        const lina = await TeamMember.create({ provider: provider._id, name: 'Lina', role: 'Stylist', offersAllServices: true });
        await giveHours(lina);
        const client = await makeUser({ name: 'Existing Client' });
        const existing = await makeAppointment(client._id, svc._id, provider._id, { status: 'confirmed' });

        const visible = async () => {
            const [listing, profile, slug, services, staff, search] = await Promise.all([
                request(app).get('/api/providers'),
                request(app).get(`/api/providers/${provider._id}`),
                request(app).get('/api/providers/by-slug/suspend-me'),
                request(app).get('/api/services'),
                request(app).get(`/api/providers/${provider._id}/staff`),
                request(app).get('/api/providers/search').query({ date: soon() }),
            ]);
            return {
                listing: listing.body.data.some((p) => String(p._id) === String(provider._id)),
                profile: profile.status,
                slug: slug.status,
                services: services.body.data.some((s) => String(s._id) === String(svc._id)),
                staff: staff.body.data.length,
                search: search.body.data.some((r) => String(r.provider) === String(provider._id)),
            };
        };

        expect(await visible()).toEqual({ listing: true, profile: 200, slug: 200, services: true, staff: 2, search: true });

        const off = await request(app).put(`/api/users/${provider._id}/active`).set(authHeader(admin));
        expect(off.body.data.isActive).toBe(false);
        expect(await visible()).toEqual({ listing: false, profile: 404, slug: 404, services: false, staff: 0, search: false });
        const refused = await guestBooking(svc);
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('provider_unavailable');
        expect(refused.body.message).toMatch(/isn’t taking bookings/);
        expect((await Appointment.findById(existing._id)).status).toBe('confirmed');

        const on = await request(app).put(`/api/users/${provider._id}/active`).set(authHeader(admin));
        expect(on.body.data.isActive).toBe(true);
        expect(await visible()).toEqual({ listing: true, profile: 200, slug: 200, services: true, staff: 2, search: true });
        expect((await guestBooking(svc)).status).toBe(201);
    });
});

describe('2b · Suspension reaches the team and explains itself', () => {
    it('the team can’t sign in or use a session while the business is suspended; back on activation', async () => {
        const admin = await makeAdmin();
        const { provider } = await openBusiness();
        const staff = await makeUser({ role: 'staff', staffOf: provider._id, email: 'sam@vido.test' });
        const login = () => request(app).post('/api/auth/login').send({ email: 'sam@vido.test', password: 'Password1!', accountType: 'business' });
        expect((await login()).status).toBe(200);

        await request(app).put(`/api/users/${provider._id}/active`).set(authHeader(admin));
        const refused = await login();
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('business_suspended');
        const session = await request(app).get('/api/services/my-services').set(authHeader(staff));
        expect(session.status).toBe(403);
        expect(session.body.code).toBe('business_suspended');

        await request(app).put(`/api/users/${provider._id}/active`).set(authHeader(admin));
        expect((await login()).status).toBe(200);
    });

    it('a suspended business’s profile link says it isn’t taking bookings (a missing one is just not found)', async () => {
        const admin = await makeAdmin();
        const { provider } = await openBusiness({ slug: 'paused-shop' });
        await request(app).put(`/api/users/${provider._id}/active`).set(authHeader(admin));
        const byId = await request(app).get(`/api/providers/${provider._id}`);
        expect(byId.status).toBe(404);
        expect(byId.body.code).toBe('provider_unavailable');
        const bySlug = await request(app).get('/api/providers/by-slug/paused-shop');
        expect(bySlug.body.code).toBe('provider_unavailable');
        expect(bySlug.body.data).toBeUndefined();
        const missing = await request(app).get('/api/providers/by-slug/never-existed');
        expect(missing.status).toBe(404);
        expect(missing.body.code).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3 · Appointments tab', () => {
    it('the No-show filter returns only no-shows', async () => {
        const admin = await makeAdmin();
        const { provider, svc } = await openBusiness();
        const c = await makeUser();
        await makeAppointment(c._id, svc._id, provider._id, { status: 'confirmed' });
        const ns = await makeAppointment(c._id, svc._id, provider._id, { status: 'no-show', appointmentDate: daysFromNow(-2) });
        const res = await request(app).get('/api/appointments?status=no-show').set(authHeader(admin));
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
        expect(String(res.body.data[0]._id)).toBe(String(ns._id));
    });

    it('admins get the business name on every row; a business still gets its bare id', async () => {
        const admin = await makeAdmin();
        const { provider, svc } = await openBusiness({ businessName: 'Vido Barber' });
        await Appointment.create({
            service: svc._id, provider: provider._id, guestName: 'Gina Guest', guestEmail: 'g@guest.test',
            appointmentDate: daysFromNow(5), startTime: '09:00', endTime: '09:30', totalPrice: 50, status: 'confirmed',
        });
        const res = await request(app).get('/api/appointments').set(authHeader(admin));
        expect(res.body.data[0].provider.businessProfile.businessName).toBe('Vido Barber');
        expect(res.body.data[0].guestName).toBe('Gina Guest');
        expect(res.body.data[0].provider.email).toBeUndefined();
        const own = await request(app).get('/api/appointments').set(authHeader(provider));
        expect(typeof own.body.data[0].provider).toBe('string');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4 · Make / Remove admin', () => {
    const setRole = (actor, target, role) => request(app).put(`/api/users/${target._id}/role`).set(authHeader(actor)).send({ role });

    it('promotes a provider and puts them back exactly', async () => {
        const admin = await makeAdmin();
        const { provider } = await openBusiness();
        const up = await setRole(admin, provider, 'admin');
        expect(up.status).toBe(200);
        expect(up.body.data.role).toBe('admin');
        expect(up.body.data.roleBeforeAdmin).toBe('provider');
        // Remove admin must return them to what they were.
        expect((await setRole(admin, provider, 'customer')).status).toBe(400);
        const down = await setRole(admin, provider, 'provider');
        expect(down.status).toBe(200);
        expect(down.body.data.role).toBe('provider');
        expect(down.body.data.roleBeforeAdmin).toBeNull();
        expect(down.body.data.accountType).toBe('business');
    });

    it('an admin with no recorded earlier role is demoted to customer only', async () => {
        const admin = await makeAdmin();
        const legacy = await makeAdmin();
        expect((await setRole(admin, legacy, 'provider')).status).toBe(400);
        const res = await setRole(admin, legacy, 'customer');
        expect(res.status).toBe(200);
        expect(res.body.data.role).toBe('customer');
        expect(res.body.data.accountType).toBe('customer');
    });

    it('never your own admin role, and never the seeded (ADMIN_EMAIL) admin', async () => {
        const admin = await makeAdmin();
        const self = await setRole(admin, admin, 'customer');
        expect(self.status).toBe(400);
        expect(self.body.code).toBe('role_self');
        expect((await User.findById(admin._id)).role).toBe('admin');

        const prev = process.env.ADMIN_EMAIL;
        process.env.ADMIN_EMAIL = 'root@bookplus.test';
        try {
            const root = await makeAdmin({ email: 'root@bookplus.test' });
            const res = await setRole(admin, root, 'customer');
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('role_super_admin');
            const list = await request(app).get('/api/users?role=admin').set(authHeader(admin));
            const flags = Object.fromEntries(list.body.data.map((u) => [u.email, u.isSuperAdmin]));
            expect(flags['root@bookplus.test']).toBe(true);
            expect(flags[admin.email]).toBe(false);
        } finally {
            if (prev === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = prev;
        }
    });

    it('never removes the last admin', async () => {
        // Over HTTP the acting admin is always a second admin, so this guard is
        // defence in depth (e.g. the actor lost admin mid-request) — check it on
        // the controller with a stale principal.
        const target = await makeAdmin();
        const former = await makeUser();
        const ctl = require('../../controllers/userController');
        const out = {};
        const resMock = { status(c) { out.status = c; return this; }, json(body) { out.body = body; return this; } };
        await ctl.updateUserRole({ params: { id: String(target._id) }, body: { role: 'customer' }, user: { _id: former._id, role: 'admin' } }, resMock);
        expect(out.status).toBe(400);
        expect(out.body.code).toBe('role_last_admin');
        expect((await User.findById(target._id)).role).toBe('admin');
    });

    it('staff logins are never offered admin', async () => {
        const admin = await makeAdmin();
        const { provider } = await openBusiness();
        const staff = await makeUser({ role: 'staff', staffOf: provider._id });
        const res = await setRole(admin, staff, 'admin');
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('role_team_login');
        expect((await User.findById(staff._id)).role).toBe('staff');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('5 · Wallet: credit any business', () => {
    it('credits a business with no account row (creating it); a debit never creates one', async () => {
        const admin = await makeAdmin();
        const { provider } = await openBusiness();
        expect(await ProviderWallet.exists({ provider: provider._id })).toBeFalsy();

        const debit = await request(app).post('/api/provider-wallet/admin/adjust').set(authHeader(admin))
            .send({ providerId: String(provider._id), amount: 10, direction: 'debit' });
        expect(debit.status).toBe(400);
        expect(await ProviderWallet.exists({ provider: provider._id })).toBeFalsy();

        const credit = await request(app).post('/api/provider-wallet/admin/adjust').set(authHeader(admin))
            .send({ providerId: String(provider._id), amount: 250, direction: 'credit', reason: 'Launch credit' });
        expect(credit.status).toBe(201);
        expect((await ProviderWallet.findOne({ provider: provider._id })).balance).toBe(250);

        const over = await request(app).post('/api/provider-wallet/admin/adjust').set(authHeader(admin))
            .send({ providerId: String(provider._id), amount: 300, direction: 'debit' });
        expect(over.status).toBe(400);
        expect((await ProviderWallet.findOne({ provider: provider._id })).balance).toBe(250);

        // The picker's source: every provider, searchable, admin-only.
        // Searchable by business name too.
        const list = await request(app).get('/api/users').query({ role: 'provider', search: 'vido barb' }).set(authHeader(admin));
        expect(list.body.data.map((u) => String(u._id))).toContain(String(provider._id));
        expect((await request(app).get('/api/users?role=provider').set(authHeader(provider))).status).toBe(403);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('6 · One definition of users', () => {
    it('Insights totals, new-user counts and the console overview agree (no admins, staff apart)', async () => {
        const admin = await makeAdmin();
        await makeAdmin();
        const { provider } = await openBusiness();
        await makeUser();
        await makeUser();
        await makeUser({ role: 'staff', staffOf: provider._id });
        await makeUser({ deletedAt: new Date(), isActive: false, name: 'Deleted user' });
        await Appointment.create({
            service: (await makeService(provider._id))._id, provider: provider._id, walkInName: 'W',
            appointmentDate: daysFromNow(2), startTime: '09:00', endTime: '09:30', totalPrice: 1, status: 'pending',
        });

        const ins = (await request(app).get('/api/analytics').set(authHeader(admin))).body.data;
        expect(ins.users.total).toBe(3);        // 2 clients + 1 business
        expect(ins.users.customers).toBe(2);
        expect(ins.users.providers).toBe(1);
        expect(ins.users.teamLogins).toBe(1);
        expect(ins.users.newThisMonth).toBe(3); // was 6: admins, staff and the closed account slipped in
        expect(ins.users.newLastWeek).toBe(3);
        expect(ins.newUsersOverTime.reduce((n, d) => n + d.count, 0)).toBe(3);

        const ov = await request(app).get('/api/analytics/admin/overview').set(authHeader(admin));
        expect(ov.status).toBe(200);
        expect(ov.body.data).toMatchObject({ users: 3, teamLogins: 1, pending: 1, appointments: 1, admins: 2 });
        expect(ov.body.data.activeServices).toBe(2);
        expect(ins.users.teamBusinesses).toBe(1);
        expect(ins.appointments.pending).toBe(1);
        expect((await request(app).get('/api/analytics/admin/overview').set(authHeader(provider))).status).toBe(403);
    });

    it('Revenue on the console card matches the Revenue tab’s total', async () => {
        const admin = await makeAdmin();
        const { provider, svc } = await openBusiness();
        const c = await makeUser();
        await makeAppointment(c._id, svc._id, provider._id, { status: 'completed', totalPrice: 120, appointmentDate: daysFromNow(-2) });
        await makeAppointment(c._id, svc._id, provider._id, { status: 'confirmed', totalPrice: 999 });
        const ov = await request(app).get('/api/analytics/admin/overview').set(authHeader(admin));
        const tab = await request(app).get('/api/analytics/admin/providers').set(authHeader(admin));
        expect(ov.body.data.revenue).toBe(120);
        expect(ov.body.data.revenue).toBe(tab.body.data.platform.totalRevenue);
    });

    it('Pending is counted on the server, not from one page', async () => {
        const admin = await makeAdmin();
        const { provider, svc } = await openBusiness();
        const c = await makeUser();
        for (let i = 0; i < 25; i += 1) {
            await makeAppointment(c._id, svc._id, provider._id, { status: 'pending', appointmentDate: daysFromNow(3 + i) });
        }
        const ov = await request(app).get('/api/analytics/admin/overview').set(authHeader(admin));
        expect(ov.body.data.pending).toBe(25);
    });
});

describe('Delete dialog numbers', () => {
    it('GET /api/users/:id/delete-preview counts what a business delete touches (admin only)', async () => {
        const admin = await makeAdmin();
        const { provider, svc } = await openBusiness();
        await makeService(provider._id, { isActive: false });
        await TeamMember.create({ provider: provider._id, name: 'Erastus' });
        await makeUser({ role: 'staff', staffOf: provider._id });
        const c = await makeUser();
        await makeAppointment(c._id, svc._id, provider._id, { status: 'confirmed' });
        await makeAppointment(c._id, svc._id, provider._id, { status: 'completed', appointmentDate: daysFromNow(-3) });
        const res = await request(app).get(`/api/users/${provider._id}/delete-preview`).set(authHeader(admin));
        expect(res.body.data).toEqual({ role: 'provider', services: 1, teamMembers: 1, staffLogins: 1, upcomingBookings: 1, pastBookings: 1 });
        const client = await request(app).get(`/api/users/${c._id}/delete-preview`).set(authHeader(admin));
        expect(client.body.data).toEqual({ role: 'customer', bookings: 2 });
        expect((await request(app).get(`/api/users/${c._id}/delete-preview`).set(authHeader(provider))).status).toBe(403);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('7 · Staff role filter', () => {
    it('GET /api/users?role=staff lists team member logins only', async () => {
        const admin = await makeAdmin();
        const { provider } = await openBusiness();
        const s = await makeUser({ role: 'staff', staffOf: provider._id, name: 'Sam Staff' });
        await makeUser();
        const res = await request(app).get('/api/users?role=staff').set(authHeader(admin));
        expect(res.status).toBe(200);
        expect(res.body.data.map((u) => String(u._id))).toEqual([String(s._id)]);
        // The table shows "Staff · <business>".
        expect(res.body.data[0].staffOf.businessProfile.businessName).toBe('Vido Barber');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('scripts/report_orphans.js', () => {
    it('reports orphaned services and nameless bookings by id and count, and writes nothing', async () => {
        const admin = await makeAdmin();
        const { provider, svc } = await openBusiness();
        await makeService(provider._id, { isActive: false });
        const client = await makeUser({ name: 'Private Name', email: 'private@test.com' });
        await makeAppointment(client._id, svc._id, provider._id);
        await Service.create({ name: 'Global', description: 'x', price: 1, duration: 30, provider: null, createdBy: admin._id });
        // What an old admin delete left: the rows gone, the references kept.
        await User.deleteOne({ _id: provider._id });
        await User.deleteOne({ _id: client._id });
        const before = await Promise.all([Service.find().lean(), Appointment.find().lean()]);

        const r = await findOrphans();
        expect(r.orphanServices).toEqual([{ business: String(provider._id), services: 2, active: 1 }]);
        expect(r.oddGlobals).toBe(0);
        expect(r.missingCustomerNoName).toBe(1);
        expect(r.nullCustomerNoName).toBe(0);
        const lines = report(r).join('\n');
        expect(lines).toMatch(/2 service\(s\) \(1 still marked active\) belong to 1 deleted business/);
        expect(lines).toContain(String(provider._id));
        expect(lines).not.toMatch(/Private Name|private@test\.com/);

        // Read-only and idempotent.
        expect(await Promise.all([Service.find().lean(), Appointment.find().lean()])).toEqual(before);
        expect(await findOrphans()).toEqual(r);
    });

    it('says so when there is nothing to report', async () => {
        const lines = report(await findOrphans());
        expect(lines[0]).toMatch(/no services belong to a deleted business/);
        expect(lines[2]).toMatch(/every booking has a client/);
    });
});
