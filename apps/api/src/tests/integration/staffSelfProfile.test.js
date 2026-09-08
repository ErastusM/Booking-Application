/**
 * Staff self-service (token-scoped): a signed-in team member manages their OWN
 *   GET/PUT /api/team/mine/profile        — name, phone, photo
 *   GET/PUT /api/team/mine/availability    — weekly working hours
 *
 * Also guards the route ordering: /mine/availability must resolve to the
 * self handler, not be swallowed by /:id/availability with id='mine'.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, authHeader } = require('../helpers/factories');
const User = require('../../models/User');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// An owner + a linked staff member (their own login), the shape myMemberDoc resolves.
const makeTeam = async () => {
    const owner = await makeProvider();
    const staff = await User.create({
        name: 'Lungu', email: 'lungu@staff.test', password: 'Password1!', phone: '+264810000010',
        role: 'staff', staffOf: owner._id, accountType: 'business', isVerified: true, provider: 'local',
    });
    const member = await TeamMember.create({
        provider: owner._id, name: 'Lungu', role: 'Barber', phone: '+264810000010', user: staff._id,
    });
    return { owner, staff, member };
};

describe('GET/PUT /api/team/mine/profile', () => {
    it('returns the member’s own profile', async () => {
        const { staff } = await makeTeam();
        const res = await request(app).get('/api/team/mine/profile').set(authHeader(staff));
        expect(res.status).toBe(200);
        expect(res.body.data.name).toBe('Lungu');
        expect(res.body.data.role).toBe('Barber');
    });

    it('updates only the fields sent (name, phone, photo)', async () => {
        const { staff, member } = await makeTeam();
        const res = await request(app).put('/api/team/mine/profile').set(authHeader(staff))
            .send({ name: 'Lungu M.', phone: '+264810999999', photoUrl: 'https://img.test/p.jpg' });
        expect(res.status).toBe(200);
        const after = await TeamMember.findById(member._id);
        expect(after.name).toBe('Lungu M.');
        expect(after.phone).toBe('+264810999999');
        expect(after.photoUrl).toBe('https://img.test/p.jpg');
        expect(after.role).toBe('Barber'); // untouched
    });

    it('rejects an empty name', async () => {
        const { staff } = await makeTeam();
        const res = await request(app).put('/api/team/mine/profile').set(authHeader(staff)).send({ name: '   ' });
        expect(res.status).toBe(400);
    });

    it('404s for a user with no staff profile (e.g. the owner)', async () => {
        const { owner } = await makeTeam();
        const res = await request(app).get('/api/team/mine/profile').set(authHeader(owner));
        expect(res.status).toBe(404);
    });
});

describe('GET/PUT /api/team/mine/availability', () => {
    it('is null before any custom hours are set (inherits business hours)', async () => {
        const { staff } = await makeTeam();
        const res = await request(app).get('/api/team/mine/availability').set(authHeader(staff));
        expect(res.status).toBe(200);          // resolves to the self handler, not /:id with id='mine'
        expect(res.body.data).toBeNull();
    });

    it('upserts the member’s own weekly schedule', async () => {
        const { staff, member } = await makeTeam();
        const schedule = {
            monday: { enabled: true, slots: [{ start: '09:00', end: '17:00' }] },
            tuesday: { enabled: false, slots: [{ start: '09:00', end: '17:00' }] },
        };
        const res = await request(app).put('/api/team/mine/availability').set(authHeader(staff)).send({ schedule });
        expect(res.status).toBe(200);
        const saved = await StaffAvailability.findOne({ teamMember: member._id });
        expect(saved).toBeTruthy();
        expect(saved.schedule.monday.slots[0].start).toBe('09:00');
    });

    it('rejects an inverted time range', async () => {
        const { staff } = await makeTeam();
        const res = await request(app).put('/api/team/mine/availability').set(authHeader(staff))
            .send({ schedule: { monday: { enabled: true, slots: [{ start: '17:00', end: '09:00' }] } } });
        expect(res.status).toBe(400);
    });
});
