/**
 * Member profile depth — bio / pronouns / languages (public) and
 * employment / notes (owner-only HR).
 *
 * The load-bearing property here is the PUBLIC/PRIVATE split: bio, pronouns and
 * languages are shown to customers on the professional's profile, while
 * employment details and internal notes must never leave the business. These
 * pin the owner write path, the customer-facing read (the leak guard), and the
 * staff-self edit boundary (a member may set their own public presentation but
 * not their own HR record).
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const makeMember = (providerId, over = {}) =>
    TeamMember.create({ provider: providerId, name: 'Moses Hamalwa', role: 'Barber', ...over });

describe('owner sets member profile depth', () => {
    it('stores bio/pronouns/languages and the owner-only employment/notes', async () => {
        const provider = await makeProvider();
        const member = await makeMember(provider._id);

        const res = await request(app)
            .put(`/api/team/${member._id}`)
            .set(authHeader(provider))
            .send({
                bio: 'Ten years behind the chair. Fades a specialty.',
                pronouns: 'he/him',
                languages: ['English', 'Oshiwambo', 'Afrikaans'],
                employment: { type: 'Employed', startDate: '2021-03-01' },
                notes: 'Prefers morning shifts. Up for a raise review in Q3.',
            });

        expect(res.status).toBe(200);
        expect(res.body.data.bio).toMatch(/Ten years/);
        expect(res.body.data.pronouns).toBe('he/him');
        expect(res.body.data.languages).toEqual(['English', 'Oshiwambo', 'Afrikaans']);
        expect(res.body.data.employment.type).toBe('Employed');
        expect(res.body.data.notes).toMatch(/morning shifts/);

        // getMyTeam (owner view) surfaces all of it.
        const team = await request(app).get('/api/team').set(authHeader(provider));
        const row = team.body.data.find((m) => String(m._id) === String(member._id));
        expect(row.bio).toMatch(/Ten years/);
        expect(row.notes).toMatch(/morning shifts/);
        expect(row.employment.type).toBe('Employed');
    });

    it('normalises languages: trims, drops blanks, caps at 12', async () => {
        const provider = await makeProvider();
        const member = await makeMember(provider._id);
        const many = Array.from({ length: 15 }, (_, i) => `  Lang${i}  `).concat(['', '   ']);

        const res = await request(app)
            .put(`/api/team/${member._id}`)
            .set(authHeader(provider))
            .send({ languages: many });

        expect(res.status).toBe(200);
        expect(res.body.data.languages).toHaveLength(12);
        expect(res.body.data.languages[0]).toBe('Lang0'); // trimmed
        expect(res.body.data.languages).not.toContain(''); // blanks dropped
    });

    it("refuses another provider's member", async () => {
        const provider = await makeProvider();
        const intruder = await makeProvider();
        const member = await makeMember(provider._id);

        const res = await request(app)
            .put(`/api/team/${member._id}`)
            .set(authHeader(intruder))
            .send({ notes: 'trying to peek/poke' });

        expect(res.status).toBe(404);
        expect((await TeamMember.findById(member._id)).notes).toBe('');
    });
});

describe('customer-facing professional list — the leak guard', () => {
    it('exposes bio/pronouns/languages but NOT employment or notes', async () => {
        const provider = await makeProvider();
        await makeMember(provider._id, {
            bio: 'Public bio', pronouns: 'she/her', languages: ['English'],
            employment: { type: 'Contractor', startDate: '2020-01-01' },
            notes: 'PRIVATE — should never ship',
        });

        const res = await request(app).get(`/api/providers/${provider._id}/staff`);
        expect(res.status).toBe(200);
        const row = res.body.data.find((m) => m.name === 'Moses Hamalwa');
        expect(row).toBeTruthy();
        // Public fields present…
        expect(row.bio).toBe('Public bio');
        expect(row.pronouns).toBe('she/her');
        expect(row.languages).toEqual(['English']);
        // …owner-only fields absent.
        expect(row.notes).toBeUndefined();
        expect(row.employment).toBeUndefined();
        // And the pre-existing private fields stay absent too.
        expect(row.email).toBeUndefined();
        expect(row.phone).toBeUndefined();
        // Belt-and-braces: the serialised payload never contains the secret string.
        expect(JSON.stringify(res.body)).not.toMatch(/should never ship/);
    });
});

describe('staff self-service profile', () => {
    const linkedStaff = async (provider, memberOver = {}) => {
        const member = await makeMember(provider._id, memberOver);
        const login = await makeUser({ role: 'staff', staffOf: provider._id, email: 'moses@test.com' });
        await TeamMember.updateOne({ _id: member._id }, { $set: { user: login._id } });
        return { member, login };
    };

    it('lets a member set their own bio/pronouns/languages', async () => {
        const provider = await makeProvider();
        const { member, login } = await linkedStaff(provider);

        const res = await request(app)
            .put('/api/team/mine/profile')
            .set(authHeader(login))
            .send({ bio: 'My own words', pronouns: 'they/them', languages: ['English', '  '] });

        expect(res.status).toBe(200);
        expect(res.body.data.bio).toBe('My own words');
        expect(res.body.data.pronouns).toBe('they/them');
        expect(res.body.data.languages).toEqual(['English']); // blank dropped
        const saved = await TeamMember.findById(member._id);
        expect(saved.bio).toBe('My own words');
    });

    it('does NOT let a member edit their own employment or notes via self-service', async () => {
        const provider = await makeProvider();
        const { member, login } = await linkedStaff(provider, {
            notes: 'owner note', employment: { type: 'Employed' },
        });

        const res = await request(app)
            .put('/api/team/mine/profile')
            .set(authHeader(login))
            .send({ bio: 'ok', notes: 'I gave myself a glowing review', employment: { type: 'Owner' } });

        expect(res.status).toBe(200);
        const saved = await TeamMember.findById(member._id);
        expect(saved.bio).toBe('ok');            // the allowed field changed
        expect(saved.notes).toBe('owner note');  // the HR fields did not
        expect(saved.employment.type).toBe('Employed');
    });
});
