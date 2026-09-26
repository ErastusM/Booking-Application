/**
 * CRM client list: a customer who books online appears automatically, AND a
 * walk-in logged by the provider (name only, no account) appears as its own
 * client instead of being hidden under the provider.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const Appointment = require('../../models/Appointment');
const { makeProvider, makeUser, makeService, makeAppointment, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

describe('GET /api/crm/clients', () => {
    it('lists registered bookers and walk-ins, but not the provider themselves', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const customer = await makeUser({ name: 'Real Customer' });

        // Registered online booking
        await makeAppointment(customer._id, svc._id, provider._id, { status: 'confirmed' });
        // Walk-in logged by the provider (customer = provider id + walkInName)
        await Appointment.create({
            customer: provider._id, service: svc._id, provider: provider._id,
            appointmentDate: new Date(Date.now() + 3 * 864e5), startTime: '11:00', endTime: '11:30',
            totalPrice: 50, status: 'completed', walkInName: 'Jane Walk-in',
        });

        const res = await request(app).get('/api/crm/clients').set(authHeader(provider));
        expect(res.status).toBe(200);
        const names = res.body.data.map((c) => c.customer.name).sort();
        expect(names).toEqual(['Jane Walk-in', 'Real Customer']);
        // Provider must not be listed as their own client
        expect(names).not.toContain(provider.name);

        const walkin = res.body.data.find((c) => c.customer.name === 'Jane Walk-in');
        expect(walkin.isWalkIn).toBe(true);
        expect(walkin.visits).toBe(1);
        expect(String(walkin.customer._id)).toMatch(/^walkin:/);
    });

    it('resolves a walk-in client detail by name (no note)', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        await Appointment.create({
            customer: provider._id, service: svc._id, provider: provider._id,
            appointmentDate: new Date(Date.now() + 3 * 864e5), startTime: '09:00', endTime: '09:30',
            totalPrice: 50, status: 'completed', walkInName: 'Jane Walk-in',
        });

        const res = await request(app).get('/api/crm/clients/walkin:jane walk-in').set(authHeader(provider));
        expect(res.status).toBe(200);
        expect(res.body.data.appointments).toHaveLength(1);
        expect(res.body.data.note).toBeNull();
    });
});

// The New Appointment client list shows each client's picture, phone, visit
// count and last visit. avatar was added to the roll-up for it; every other
// field and the scoping are unchanged.
describe('GET /api/crm/clients — the fields the New Appointment client list reads', () => {
    it('returns picture, phone, visits and last visit; a walk-in has no picture', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const pic = 'https://res.cloudinary.com/demo/image/upload/v1/avatars/ava.jpg';
        const ava = await makeUser({ name: 'Ava Picture', phone: '+264811234567', avatar: pic });
        const early = new Date(Date.now() - 20 * 864e5);
        const late = new Date(Date.now() - 2 * 864e5);
        await makeAppointment(ava._id, svc._id, provider._id, { status: 'completed', appointmentDate: early });
        await makeAppointment(ava._id, svc._id, provider._id, { status: 'completed', appointmentDate: late, startTime: '12:00', endTime: '12:30' });
        await Appointment.create({
            customer: provider._id, service: svc._id, provider: provider._id,
            appointmentDate: late, startTime: '14:00', endTime: '14:30',
            totalPrice: 50, status: 'completed', walkInName: 'Wally Walk-in',
        });

        const res = await request(app).get('/api/crm/clients').set(authHeader(provider));
        expect(res.status).toBe(200);
        const row = res.body.data.find((c) => c.customer.name === 'Ava Picture');
        expect(row.customer.avatar).toBe(pic);
        expect(row.customer.phone).toBe('+264811234567');
        expect(row.visits).toBe(2);
        expect(new Date(row.lastVisit).getTime()).toBe(late.getTime());
        // Still no password or other account fields.
        expect(row.customer.password).toBeUndefined();
        expect(Object.keys(row.customer).sort()).toEqual(['_id', 'avatar', 'createdAt', 'email', 'name', 'phone']);

        const walk = res.body.data.find((c) => c.customer.name === 'Wally Walk-in');
        expect(walk.isWalkIn).toBe(true);
        expect(walk.customer.avatar).toBeNull();
    });

    it("a team member still sees only the clients they serve (with pictures), never a colleague's", async () => {
        const TeamMember = require('../../models/TeamMember');
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const memberUser = await makeUser({ role: 'staff', staffOf: provider._id, staffPermissions: ['calendar:self', 'clients:assigned'] });
        const mine = await TeamMember.create({ provider: provider._id, name: 'Mine', user: memberUser._id });
        const other = await TeamMember.create({ provider: provider._id, name: 'Other' });
        const myClient = await makeUser({ name: 'My Pic Client', avatar: 'https://example.com/a.png' });
        const theirClient = await makeUser({ name: 'Their Pic Client', avatar: 'https://example.com/b.png' });
        await makeAppointment(myClient._id, svc._id, provider._id, { status: 'completed', teamMember: mine._id });
        await makeAppointment(theirClient._id, svc._id, provider._id, { status: 'completed', teamMember: other._id });

        const member = await request(app).get('/api/crm/clients').set(authHeader(memberUser));
        expect(member.status).toBe(200);
        expect(member.body.data.map((c) => c.customer.name)).toEqual(['My Pic Client']);
        expect(member.body.data[0].customer.avatar).toBe('https://example.com/a.png');

        const owner = await request(app).get('/api/crm/clients').set(authHeader(provider));
        expect(owner.body.data.map((c) => c.customer.name).sort()).toEqual(['My Pic Client', 'Their Pic Client']);
    });
});

// "N visits" and "last visit" in the New Appointment client list count visits
// that happened: completed bookings only. They are NEW fields (completedVisits,
// lastCompletedVisit); visits / lastVisit keep counting every booking, as the
// Clients tab reads them.
describe('GET /api/crm/clients — completedVisits / lastCompletedVisit', () => {
    const day = (offset) => new Date(Date.now() + offset * 864e5);
    let slot = 0;
    const at = () => { slot += 1; const h = String(8 + (slot % 10)).padStart(2, '0'); return { startTime: `${h}:00`, endTime: `${h}:30` }; };

    it('counts only completed bookings, dates the latest one, and leaves visits / lastVisit as they were', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const kim = await makeUser({ name: 'Kim Counted' });
        const newbie = await makeUser({ name: 'Nia New' });
        const doneOld = day(-30);
        const doneNew = day(-5);
        const upcoming = day(6);
        await makeAppointment(kim._id, svc._id, provider._id, { status: 'completed', appointmentDate: doneOld, ...at() });
        await makeAppointment(kim._id, svc._id, provider._id, { status: 'completed', appointmentDate: doneNew, ...at() });
        await makeAppointment(kim._id, svc._id, provider._id, { status: 'cancelled', appointmentDate: day(-2), ...at() });
        await makeAppointment(kim._id, svc._id, provider._id, { status: 'no-show', appointmentDate: day(-1), ...at() });
        await makeAppointment(kim._id, svc._id, provider._id, { status: 'confirmed', appointmentDate: upcoming, ...at() });
        await makeAppointment(newbie._id, svc._id, provider._id, { status: 'confirmed', appointmentDate: day(3), ...at() });
        await Appointment.create({
            customer: provider._id, service: svc._id, provider: provider._id,
            appointmentDate: day(-4), ...at(), totalPrice: 50, status: 'completed', walkInName: 'Wendy Walk-in',
        });

        const res = await request(app).get('/api/crm/clients').set(authHeader(provider));
        expect(res.status).toBe(200);
        const by = (name) => res.body.data.find((c) => c.customer.name === name);

        const k = by('Kim Counted');
        expect(k.completedVisits).toBe(2);
        expect(new Date(k.lastCompletedVisit).getTime()).toBe(doneNew.getTime());
        // Unchanged: every booking, and the latest date of any of them.
        expect(k.visits).toBe(5);
        expect(new Date(k.lastVisit).getTime()).toBe(upcoming.getTime());

        const n = by('Nia New');
        expect(n.completedVisits).toBe(0);
        expect(n.lastCompletedVisit).toBeNull();
        expect(n.visits).toBe(1);

        const w = by('Wendy Walk-in');
        expect(w.completedVisits).toBe(1);
        expect(w.lastCompletedVisit).toBeTruthy();
    });

    it('a team member counts only the completed visits they performed; the owner counts all of them', async () => {
        const TeamMember = require('../../models/TeamMember');
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const memberUser = await makeUser({ role: 'staff', staffOf: provider._id, staffPermissions: ['calendar:self', 'clients:assigned'] });
        const mine = await TeamMember.create({ provider: provider._id, name: 'Mine', user: memberUser._id });
        const other = await TeamMember.create({ provider: provider._id, name: 'Other' });
        const shared = await makeUser({ name: 'Shared Client' });
        const onlyTheirs = await makeUser({ name: 'Their Client' });
        const mineDone = day(-20);
        const otherDone = day(-3);
        await makeAppointment(shared._id, svc._id, provider._id, { status: 'completed', teamMember: mine._id, appointmentDate: mineDone, ...at() });
        await makeAppointment(shared._id, svc._id, provider._id, { status: 'completed', teamMember: other._id, appointmentDate: otherDone, ...at() });
        await makeAppointment(shared._id, svc._id, provider._id, { status: 'completed', teamMember: other._id, appointmentDate: day(-10), ...at() });
        await makeAppointment(onlyTheirs._id, svc._id, provider._id, { status: 'completed', teamMember: other._id, appointmentDate: day(-8), ...at() });

        const member = await request(app).get('/api/crm/clients').set(authHeader(memberUser));
        expect(member.status).toBe(200);
        expect(member.body.data.map((c) => c.customer.name)).toEqual(['Shared Client']);
        expect(member.body.data[0].completedVisits).toBe(1);
        expect(new Date(member.body.data[0].lastCompletedVisit).getTime()).toBe(mineDone.getTime());

        const owner = await request(app).get('/api/crm/clients').set(authHeader(provider));
        const s = owner.body.data.find((c) => c.customer.name === 'Shared Client');
        expect(s.completedVisits).toBe(3);
        expect(new Date(s.lastCompletedVisit).getTime()).toBe(otherDone.getTime());
        expect(owner.body.data.map((c) => c.customer.name).sort()).toEqual(['Shared Client', 'Their Client']);
    });
});
