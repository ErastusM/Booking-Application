/**
 * The deploy report of who stops being bookable (scripts/report_members_without_hours.js).
 *
 * Read-only and counts only: per business, how many active, bookable team
 * members have no working hours of their own (no weekly hours, no shift from
 * today on). It must never print a name, email or phone, and never write.
 */
const testDb = require('../helpers/testDb');
const { makeProvider, makeUser, makeService, everyDayHours, giveHours } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const Appointment = require('../../models/Appointment');
const WaitingList = require('../../models/WaitingList');
const Shift = require('../../models/Shift');
const StaffAvailability = require('../../models/StaffAvailability');
const { membersWithoutHours, report } = require('../../../scripts/report_members_without_hours');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const TODAY = '2026-09-26';

describe('report_members_without_hours', () => {
    it('counts, per business, the active bookable members with no hours of their own', async () => {
        const vido = await makeProvider({ name: 'Vido Barber' });
        const other = await makeProvider({ name: 'Other Shop' });
        const mk = (provider, name, extra = {}) => TeamMember.create({
            provider: provider._id, name, email: `${name.toLowerCase().replace(/\s/g, '')}@private.test`, phone: '+264811234567', ...extra,
        });
        const withHours = await mk(vido, 'Erastus Weekly');
        await giveHours(withHours, everyDayHours('08:00', '17:00'));
        const shiftOnly = await mk(vido, 'Hilda Shift');
        await Shift.create({ provider: vido._id, teamMember: shiftOnly._id, date: '2026-10-01', slots: [{ start: '09:00', end: '13:00' }] });
        const pastShift = await mk(vido, 'Basic Pastshift');
        await Shift.create({ provider: vido._id, teamMember: pastShift._id, date: '2026-09-01', slots: [{ start: '09:00', end: '13:00' }] });
        const lina = await mk(vido, 'Lina None');
        // What Lina holds: two upcoming bookings (one as a segment of a shared
        // ticket), one in the past and one cancelled (not counted), and a place
        // in a waiting list.
        const client = await makeUser();
        const cut = await makeService(vido._id);
        const booking = (date, extra = {}) => Appointment.create({
            customer: client._id, service: cut._id, provider: vido._id, appointmentDate: new Date(`${date}T00:00:00.000Z`),
            startTime: '10:00', endTime: '10:30', status: 'confirmed', totalPrice: 50, teamMember: lina._id, ...extra,
        });
        await booking('2026-10-02');
        await booking('2026-10-03', {
            teamMember: withHours._id,
            services: [
                { service: cut._id, teamMember: withHours._id, startTime: '10:00', endTime: '10:15', price: 25 },
                { service: cut._id, teamMember: lina._id, startTime: '10:15', endTime: '10:30', price: 25 },
            ],
        });
        await booking('2026-09-01');
        await booking('2026-10-04', { status: 'cancelled' });
        await WaitingList.create({
            service: cut._id, provider: vido._id, customer: client._id, teamMember: lina._id,
            appointmentDate: new Date('2026-10-05T00:00:00.000Z'), startTime: '10:00', endTime: '10:30', position: 1,
        });
        await mk(vido, 'Front Desk', { bookable: false });   // never bookable — not counted
        await mk(vido, 'Gone Member', { isActive: false });   // archived — not counted
        await mk(other, 'Sam Other');
        const before = await StaffAvailability.countDocuments();

        const rows = await membersWithoutHours({ today: TODAY });

        expect(rows).toEqual([
            { business: String(vido._id), withoutHours: 2, bookable: 4, upcomingBookings: 2, waiting: 1 },
            { business: String(other._id), withoutHours: 1, bookable: 1, upcomingBookings: 0, waiting: 0 },
        ]);
        // Read-only.
        expect(await StaffAvailability.countDocuments()).toBe(before);

        const lines = report(rows).join('\n');
        expect(lines).toContain(`business ${vido._id}: 2 of 4 bookable member(s) without hours · 2 upcoming booking(s) and 1 waiting-list place(s) with them`);
        expect(lines).toContain('3 active, bookable team member(s) in 2 business(es)');
        // Counts only — nobody's details in a deploy log.
        ['Lina', 'Basic', 'Sam', 'private.test', '+26481', 'Vido'].forEach((s) => expect(lines).not.toContain(s));
    });

    it('says so when everyone has hours', async () => {
        const vido = await makeProvider();
        const m = await TeamMember.create({ provider: vido._id, name: 'Ready' });
        await giveHours(m);
        const rows = await membersWithoutHours({ today: TODAY });
        expect(rows).toEqual([]);
        expect(report(rows)).toEqual(['report_members_without_hours: every active, bookable team member has working hours of their own.']);
    });
});
