/**
 * bookingAlertTargets — who a new booking notifies.
 *
 * A booking assigned to team members who have their own login must alert EACH
 * of them (so a multi-service ticket reaches every performer, not just the
 * primary); roster-only members without a login are skipped, and when nobody on
 * the ticket has a login the alert falls back to the business owner.
 */
const testDb = require('../helpers/testDb');
const { makeProvider } = require('../helpers/factories');
const User = require('../../models/User');
const TeamMember = require('../../models/TeamMember');
const { _bookingAlertTargets } = require('../../controllers/appointmentController');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const makeStaff = (owner, email) => User.create({
    name: `Staff ${email}`, email, password: 'Password1!', phone: '+264810000009',
    role: 'staff', staffOf: owner._id, accountType: 'business', isVerified: true, provider: 'local',
});

describe('bookingAlertTargets', () => {
    it('routes to each assigned member with a login (email + /my-schedule)', async () => {
        const owner = await makeProvider();
        const uA = await makeStaff(owner, 'a@staff.test');
        const uB = await makeStaff(owner, 'b@staff.test');
        const mA = await TeamMember.create({ provider: owner._id, name: 'Alex', user: uA._id });
        const mB = await TeamMember.create({ provider: owner._id, name: 'Blair', user: uB._id });

        const targets = await _bookingAlertTargets(owner._id, [mA._id, mB._id]);
        expect(targets).toHaveLength(2);
        const byName = Object.fromEntries(targets.map(t => [t.name, t]));
        expect(String(byName.Alex.userId)).toBe(String(uA._id));
        expect(byName.Alex.email).toBe('a@staff.test');
        expect(byName.Alex.link).toBe('/my-schedule');
        expect(String(byName.Blair.userId)).toBe(String(uB._id));
    });

    it('de-duplicates a repeated member id (multi-service, same performer twice)', async () => {
        const owner = await makeProvider();
        const u = await makeStaff(owner, 'c@staff.test');
        const m = await TeamMember.create({ provider: owner._id, name: 'Cass', user: u._id });
        const targets = await _bookingAlertTargets(owner._id, [m._id, m._id, String(m._id)]);
        expect(targets).toHaveLength(1);
    });

    it('skips roster-only members and falls back to the owner when none have a login', async () => {
        const owner = await makeProvider();
        const rosterOnly = await TeamMember.create({ provider: owner._id, name: 'Dana' }); // no user
        const targets = await _bookingAlertTargets(owner._id, [rosterOnly._id]);
        expect(targets).toHaveLength(1);
        expect(String(targets[0].userId)).toBe(String(owner._id));
        expect(targets[0].link).toBe('/dashboard');
        expect(targets[0].email).toBeNull();
    });

    it('includes only the linked members when a ticket mixes linked + roster-only', async () => {
        const owner = await makeProvider();
        const u = await makeStaff(owner, 'e@staff.test');
        const linked = await TeamMember.create({ provider: owner._id, name: 'Eli', user: u._id });
        await TeamMember.create({ provider: owner._id, name: 'Fin' }); // roster-only
        const targets = await _bookingAlertTargets(owner._id, [linked._id, null]);
        expect(targets).toHaveLength(1);
        expect(targets[0].name).toBe('Eli');
    });

    it('owner-column booking (no member) alerts the owner', async () => {
        const owner = await makeProvider();
        const targets = await _bookingAlertTargets(owner._id, [null]);
        expect(targets).toHaveLength(1);
        expect(String(targets[0].userId)).toBe(String(owner._id));
        expect(targets[0].link).toBe('/dashboard');
    });
});
