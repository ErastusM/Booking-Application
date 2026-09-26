/**
 * Every team member has their own calendar colour.
 *
 * The owner's bookings are the brand orange (#f03e16), and members used to be
 * created in that same orange (the old schema default) — so on the owner's
 * calendar nobody could be told apart. Now:
 *   - a new member (single add AND bulk add) gets the first palette colour no
 *     ACTIVE member of that business has, then cycles;
 *   - the owner can change it from the Team card through PUT /api/team/:id,
 *     which only accepts a hex colour, and only for someone who can manage the
 *     team;
 *   - scripts/migrate_member_colors.js recolours the existing members who are
 *     still on orange (or have none), per business, in joining order, and never
 *     touches a colour the owner chose.
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const {
    MEMBER_PALETTE, MEMBER_COLORS, BRAND_ORANGE, nextMemberColor, isHexColor,
} = require('../../utils/memberColors');
const { migrateMemberColors } = require('../../../scripts/migrate_member_colors');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

let seq = 0;
const add = (as, body = {}) => {
    seq += 1;
    return request(app).post('/api/team').set(authHeader(as))
        .send({ name: `Member ${seq}`, role: 'Stylist', email: `m${seq}@test.com`, ...body });
};
const update = (as, id, body) => request(app).put(`/api/team/${id}`).set(authHeader(as)).send(body);

describe('the member palette', () => {
    it('has ten distinct hex colours and leaves the owner\'s orange out', () => {
        expect(MEMBER_COLORS).toHaveLength(10);
        expect(new Set(MEMBER_COLORS).size).toBe(10);
        MEMBER_COLORS.forEach((c) => expect(isHexColor(c)).toBe(true));
        expect(MEMBER_COLORS).not.toContain(BRAND_ORANGE);
    });

    it('matches the business app\'s copy exactly', () => {
        const src = fs.readFileSync(path.join(__dirname, '../../../../business/src/utils/memberColors.js'), 'utf8');
        const business = [...src.matchAll(/\{\s*name:\s*'([^']+)',\s*hex:\s*'(#[0-9a-f]{6})'\s*\}/gi)]
            .map(([, name, hex]) => ({ name, hex }));
        expect(business).toEqual(MEMBER_PALETTE);
    });

    it('nextMemberColor: first unused, then the least used', () => {
        expect(nextMemberColor([])).toBe(MEMBER_COLORS[0]);
        expect(nextMemberColor([MEMBER_COLORS[0], MEMBER_COLORS[2]])).toBe(MEMBER_COLORS[1]);
        expect(nextMemberColor(MEMBER_COLORS)).toBe(MEMBER_COLORS[0]);
        expect(nextMemberColor([...MEMBER_COLORS, MEMBER_COLORS[0]])).toBe(MEMBER_COLORS[1]);
        // Case and unknown colours don't confuse it.
        expect(nextMemberColor([MEMBER_COLORS[0].toUpperCase(), '#123456'])).toBe(MEMBER_COLORS[1]);
    });
});

describe('a new member gets their own colour', () => {
    it('each new member gets a different palette colour, never orange', async () => {
        const owner = await makeProvider();
        const colors = [];
        for (let i = 0; i < 4; i += 1) {
            const res = await add(owner);
            expect(res.status).toBe(201);
            colors.push(res.body.data.color);
        }
        expect(colors).toEqual(MEMBER_COLORS.slice(0, 4));
    });

    it('cycles once all ten are taken', async () => {
        const owner = await makeProvider();
        const colors = [];
        for (let i = 0; i < 12; i += 1) colors.push((await add(owner)).body.data.color);
        expect(colors.slice(0, 10)).toEqual(MEMBER_COLORS);
        expect(colors.slice(10)).toEqual([MEMBER_COLORS[0], MEMBER_COLORS[1]]);
    });

    it('skips colours active members hold — including ones the owner picked — and reuses an archived member\'s', async () => {
        const owner = await makeProvider();
        const first = (await add(owner)).body.data;                                   // Blue
        await TeamMember.create({ provider: owner._id, name: 'Picked', color: MEMBER_COLORS[1] }); // Green, chosen
        // Archive the Blue member: their colour is free again.
        expect((await request(app).delete(`/api/team/${first._id}`).set(authHeader(owner))).status).toBe(200);
        const next = (await add(owner)).body.data;
        expect(next.color).toBe(MEMBER_COLORS[0]);
        const after = (await add(owner)).body.data;
        expect(after.color).toBe(MEMBER_COLORS[2]);
    });

    it('is counted per business', async () => {
        const a = await makeProvider();
        const b = await makeProvider();
        await add(a); await add(a);
        expect((await add(b)).body.data.color).toBe(MEMBER_COLORS[0]);
    });

    it('bulk add gives each row its own colour too', async () => {
        const owner = await makeProvider();
        await add(owner); // Blue
        const res = await request(app).post('/api/team/bulk').set(authHeader(owner)).send({
            members: [
                { name: 'A', role: 'Barber', email: 'a@test.com' },
                { name: 'B', role: 'Barber', email: 'b@test.com' },
                { name: 'C', role: 'Barber', email: 'c@test.com', color: '#f03e16' }, // old form default
            ],
        });
        expect(res.status).toBe(201);
        const rows = await TeamMember.find({ provider: owner._id }).sort({ createdAt: 1, _id: 1 });
        expect(rows.map((r) => r.color)).toEqual(MEMBER_COLORS.slice(0, 4));
    });

    it('keeps a colour the owner picked when adding, and treats the old orange default as "none"', async () => {
        const owner = await makeProvider();
        expect((await add(owner, { color: '#123ABC' })).body.data.color).toBe('#123abc');
        expect((await add(owner, { color: '#F03E16' })).body.data.color).toBe(MEMBER_COLORS[0]);
    });

    it('refuses a colour that is not a hex colour', async () => {
        const owner = await makeProvider();
        const res = await add(owner, { color: 'red' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/hex colour/i);
        expect(await TeamMember.countDocuments({ provider: owner._id })).toBe(0);
    });

    it('the schema no longer defaults anyone to the owner\'s orange', async () => {
        const owner = await makeProvider();
        const tm = await TeamMember.create({ provider: owner._id, name: 'Direct' });
        expect(tm.color).toBeUndefined();
    });
});

describe('the owner changes a member\'s colour', () => {
    it('saves a hex colour through the member update', async () => {
        const owner = await makeProvider();
        const m = (await add(owner)).body.data;
        const res = await update(owner, m._id, { color: MEMBER_COLORS[5].toUpperCase() });
        expect(res.status).toBe(200);
        expect(res.body.data.color).toBe(MEMBER_COLORS[5]);
        expect((await TeamMember.findById(m._id)).color).toBe(MEMBER_COLORS[5]);
    });

    it.each([
        ['a colour name', 'blue'],
        ['a CSS variable', 'var(--gold)'],
        ['injected CSS', '#fff;background:url(x)'],
        ['an empty string', ''],
        ['a number', 123],
        ['five hex digits', '#12345'],
    ])('refuses %s', async (_label, color) => {
        const owner = await makeProvider();
        const m = (await add(owner)).body.data;
        const res = await update(owner, m._id, { color });
        expect(res.status).toBe(400);
        expect((await TeamMember.findById(m._id)).color).toBe(m.color);
    });

    it('leaves the colour alone when an edit does not send one', async () => {
        const owner = await makeProvider();
        const m = (await add(owner)).body.data;
        expect((await update(owner, m._id, { phone: '081 000 0000' })).status).toBe(200);
        expect((await TeamMember.findById(m._id)).color).toBe(m.color);
    });

    it('a manager (team:manage) may change it; a member without it may not, not even their own', async () => {
        const owner = await makeProvider();
        const m = (await add(owner)).body.data;
        const high = await makeUser({ role: 'staff', staffOf: owner._id, email: 'high@test.com', staffTier: 'high' });
        await TeamMember.create({ provider: owner._id, name: 'High', role: 'Manager', user: high._id });
        const basicLogin = await makeUser({ role: 'staff', staffOf: owner._id, email: 'basic@test.com', staffTier: 'basic' });
        const basicRow = await TeamMember.create({ provider: owner._id, name: 'Basic', role: 'Stylist', user: basicLogin._id, color: MEMBER_COLORS[3] });

        expect((await update(high, m._id, { color: MEMBER_COLORS[7] })).status).toBe(200);
        expect((await TeamMember.findById(m._id)).color).toBe(MEMBER_COLORS[7]);

        expect((await update(basicLogin, basicRow._id, { color: MEMBER_COLORS[8] })).status).toBe(403);
        expect((await update(basicLogin, m._id, { color: MEMBER_COLORS[8] })).status).toBe(403);
        // Nor through their own profile endpoint.
        await request(app).put('/api/team/mine/profile').set(authHeader(basicLogin)).send({ color: MEMBER_COLORS[8] });
        expect((await TeamMember.findById(basicRow._id)).color).toBe(MEMBER_COLORS[3]);
    });
});

describe('migrate_member_colors', () => {
    // Raw inserts so createdAt (the migration's order) is exactly what the test says.
    const seed = async (provider, rows) => {
        const base = new Date('2026-01-01T00:00:00Z').getTime();
        const docs = rows.map((r, i) => {
            const d = {
                _id: new mongoose.Types.ObjectId(), provider: provider._id, name: r.name, role: 'Staff',
                isActive: r.isActive !== false, createdAt: new Date(base + (r.at ?? i) * 60000), updatedAt: new Date(),
            };
            if (r.color !== undefined) d.color = r.color;
            return d;
        });
        await TeamMember.collection.insertMany(docs);
        return docs;
    };
    const colorsOf = async (provider) => Object.fromEntries(
        (await TeamMember.find({ provider: provider._id }).lean()).map((m) => [m.name, m.color])
    );

    it('gives orange / colourless members distinct colours in joining order, keeping chosen ones', async () => {
        const owner = await makeProvider();
        await seed(owner, [
            { name: 'Late', color: '#f03e16', at: 9 },
            { name: 'First', color: '#F03E16', at: 1 },
            { name: 'Chose Green', color: MEMBER_COLORS[1], at: 2 },
            { name: 'None', at: 3 },
            { name: 'Chose Custom', color: '#123456', at: 4 },
            { name: 'Null', color: null, at: 5 },
            { name: 'Gone', color: '#f03e16', isActive: false, at: 0 },
        ]);

        const { recolored, changes } = await migrateMemberColors();
        expect(recolored).toBe(5);

        const c = await colorsOf(owner);
        expect(c['Chose Green']).toBe(MEMBER_COLORS[1]);  // never changed
        expect(c['Chose Custom']).toBe('#123456');         // never changed
        // Active members by createdAt, skipping Green (taken): Blue, Purple, Teal, Amber.
        expect(c.First).toBe(MEMBER_COLORS[0]);
        expect(c.None).toBe(MEMBER_COLORS[2]);
        expect(c.Null).toBe(MEMBER_COLORS[3]);
        expect(c.Late).toBe(MEMBER_COLORS[4]);
        // The archived member is done last and is no longer orange.
        expect(c.Gone).toBe(MEMBER_COLORS[5]);
        expect(Object.values(c)).not.toContain(BRAND_ORANGE);

        // It says what it changed.
        expect(changes.map((x) => x.name)).toEqual(['First', 'None', 'Null', 'Late', 'Gone']);
        expect(changes[0]).toMatchObject({ from: '#F03E16', to: MEMBER_COLORS[0], archived: false });
        expect(changes[1]).toMatchObject({ from: null, to: MEMBER_COLORS[2] });
    });

    it('is idempotent: a second run changes nothing', async () => {
        const owner = await makeProvider();
        await seed(owner, [{ name: 'A', color: '#f03e16' }, { name: 'B' }]);
        expect((await migrateMemberColors()).recolored).toBe(2);
        const before = await colorsOf(owner);
        const again = await migrateMemberColors();
        expect(again).toEqual({ recolored: 0, changes: [] });
        expect(await colorsOf(owner)).toEqual(before);
    });

    it('works per business, and a business with nothing to fix is untouched', async () => {
        const a = await makeProvider();
        const b = await makeProvider();
        const c = await makeProvider();
        await seed(a, [{ name: 'A1', color: '#f03e16' }, { name: 'A2', color: '#f03e16' }]);
        await seed(b, [{ name: 'B1', color: '#f03e16' }]);
        await seed(c, [{ name: 'C1', color: '#abcdef' }]);
        await migrateMemberColors();
        expect(await colorsOf(a)).toEqual({ A1: MEMBER_COLORS[0], A2: MEMBER_COLORS[1] });
        expect(await colorsOf(b)).toEqual({ B1: MEMBER_COLORS[0] });
        expect(await colorsOf(c)).toEqual({ C1: '#abcdef' });
    });

    it('cycles past ten members', async () => {
        const owner = await makeProvider();
        await seed(owner, Array.from({ length: 12 }, (_, i) => ({ name: `M${String(i).padStart(2, '0')}`, color: '#f03e16' })));
        await migrateMemberColors();
        const c = await colorsOf(owner);
        const ordered = Object.keys(c).sort().map((k) => c[k]);
        expect(ordered.slice(0, 10)).toEqual(MEMBER_COLORS);
        expect(ordered.slice(10)).toEqual(MEMBER_COLORS.slice(0, 2));
    });
});
