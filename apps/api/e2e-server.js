/**
 * Self-contained API server for end-to-end tests.
 * Boots an in-memory MongoDB (no external Mongo needed), seeds a known
 * provider + service + availability, then starts the real Express app.
 *
 * Run via: npm run e2e:server  (PORT defaults to 5050)
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e-jwt-secret';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'e2e-refresh-secret';
// passport.js instantiates the Google strategy at require time, so a machine
// without apps/api/.env (fresh CI/container) needs stand-ins to boot at all.
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'e2e-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'e2e-google-client-secret';
// E2E must never attempt real email delivery — disable SMTP before the app loads.
delete process.env.EMAIL_USER;
delete process.env.EMAIL_PASS;
const PORT = process.env.PORT || 5050;

// E2E outbox: record every email the API would send (name + args), so a spec
// can open the REAL link an invite email carries. Wraps the exports before any
// controller requires them; the original sender still runs (SMTP is off).
const outbox = [];
{
    const svc = require('./src/utils/emailService');
    for (const [name, fn] of Object.entries(svc)) {
        if (typeof fn !== 'function' || !/^send/.test(name) || name === 'sendRaw') continue;
        svc[name] = async (...args) => {
            outbox.push({ at: new Date().toISOString(), fn: name, args: JSON.parse(JSON.stringify(args)) });
            return fn(...args);
        };
    }
}

(async () => {
    const mem = await MongoMemoryServer.create();
    const uri = mem.getUri();
    await mongoose.connect(uri);

    const User = require('./src/models/User');
    const Service = require('./src/models/Service');
    const Availability = require('./src/models/Availability');
    const TeamMember = require('./src/models/TeamMember');
    const StaffAvailability = require('./src/models/StaffAvailability');
    const Appointment = require('./src/models/Appointment');

    // Seed a verified provider with a bookable service + full weekday availability
    const provider = await User.create({
        name: 'E2E Provider', email: 'e2e-provider@bookplus.dev', password: 'Password1!',
        phone: '+264810000000', role: 'provider', providerCategory: 'Home services',
        isVerified: true, provider: 'local',
        // Onboarded, so the setup wizard doesn't overlay the dashboard and
        // swallow clicks in specs that drive the calendar.
        providerSetupComplete: true,
    });
    const service = await Service.create({
        name: 'E2E Session', description: 'A test service', price: 100, duration: 30,
        provider: provider._id, createdBy: provider._id, isActive: true, location: 'Windhoek',
    });
    const everyDay = { enabled: true, slots: [{ start: '08:00', end: '18:00' }] };
    await Availability.create({
        provider: provider._id,
        schedule: {
            monday: everyDay, tuesday: everyDay, wednesday: everyDay, thursday: everyDay,
            friday: everyDay, saturday: everyDay, sunday: everyDay,
        },
    });

    // Seed a verified customer so E2E can log in without the email-verification wall
    const customer = await User.create({
        name: 'E2E Customer', email: 'e2e-customer@bookplus.dev', password: 'Password1!',
        phone: '+264810000001', role: 'customer', isVerified: true, provider: 'local',
    });

    // Seed a two-person roster + one walk-in booked on Alex today, so the
    // dashboard's staff filter and Staff (per-staff lanes) view have real
    // content to assert against.
    const [alex, billie] = await TeamMember.create([
        { provider: provider._id, name: 'Alex Rivera', role: 'Specialist', color: '#3B82F6' },
        { provider: provider._id, name: 'Billie Chen', role: 'Technician', color: '#10B981' },
    ]);
    // Nothing is inherited from the business's hours: a member with no hours of
    // their own can't be booked. Billie works the business's 08:00–18:00 every
    // day, so "any available" customer bookings (unsubscribe.spec's guest
    // bookings) and search have a real team member to land on. Alex is left
    // WITHOUT hours on purpose: the team-management spec opens his "no working
    // hours" Team card and sets them, and the Team card shows him as not
    // bookable. (Pat, below, sets his own hours in member-one-app.spec.)
    await StaffAvailability.create({
        provider: provider._id, teamMember: billie._id,
        schedule: {
            monday: everyDay, tuesday: everyDay, wednesday: everyDay, thursday: everyDay,
            friday: everyDay, saturday: everyDay, sunday: everyDay,
        },
    });
    // Wanda exists on today AND tomorrow: the suite seeds at server boot but
    // asserts against the browser's "today", and a run that starts at 23:59
    // crosses midnight between the two — the calendar then shows the next day
    // and a today-only seed vanishes (this failed a real deploy). Only one
    // Wanda is ever on screen, so every per-day assertion is unaffected.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    await Appointment.create([today, tomorrow].map((appointmentDate) => ({
        service: service._id, provider: provider._id, teamMember: alex._id,
        walkInName: 'Guest Wanda', appointmentDate,
        // A full hour, so the calendar card is tall enough to show every line
        // (short events hide the staff tag by design).
        startTime: '10:00', endTime: '11:00', status: 'confirmed', totalPrice: 100,
    })));

    // A staff member WITH a login, for the self-service specs (staff manage
    // their own services on My schedule). Not bookable, so they never enter
    // customer "any available" resolution and can't perturb the booking specs;
    // lastLoginAt is set so they read as an active member, not a pending invite.
    // Like every member he runs his own column — he blocks his own time, but
    // his closed column takes no bookings (member-own-calendar.spec).
    const samUser = await User.create({
        name: 'Sam Staff', email: 'e2e-staff@bookplus.dev', password: 'Password1!',
        phone: '+264810000002', role: 'staff', staffOf: provider._id, isVerified: true,
        provider: 'local',
        lastLoginAt: new Date(),
    });
    await TeamMember.create({
        provider: provider._id, name: 'Sam Staff', role: 'Specialist', color: '#8B5CF6',
        user: samUser._id, bookable: false,
    });

    // A bookable team member with a login, for the one-app member spec
    // (member-one-app.spec): Pat performs E2E Session at his own price and time,
    // and once served "E2E Regular" (a completed booking two days ago), so he can
    // book that existing client and has takings of his own on Earnings. The
    // regular is a separate customer so the customer-app specs' E2E Customer
    // never gains a past visit (and a review prompt).
    const patUser = await User.create({
        name: 'Pat Provider', email: 'e2e-member@bookplus.dev', password: 'Password1!',
        phone: '+264810000005', role: 'staff', staffOf: provider._id, isVerified: true,
        provider: 'local', lastLoginAt: new Date(),
    });
    const pat = await TeamMember.create({
        provider: provider._id, name: 'Pat Provider', role: 'Stylist', color: '#F59E0B',
        user: patUser._id, bookable: true, offersAllServices: false, services: [service._id],
        serviceOverrides: [{ service: service._id, price: 120, duration: 45 }],
    });
    const regular = await User.create({
        name: 'E2E Regular', email: 'e2e-regular@bookplus.dev', password: 'Password1!',
        phone: '+264810000006', role: 'customer', isVerified: true, provider: 'local',
    });
    const twoDaysAgo = new Date(today); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    await Appointment.create({
        service: service._id, provider: provider._id, teamMember: pat._id, customer: regular._id,
        appointmentDate: twoDaysAgo, startTime: '09:00', endTime: '09:45', status: 'completed', totalPrice: 120,
    });

    // Past clients of the owner, across the alphabet, for the Clients tab spec
    // (clients-tab.spec): enough of them that the list shows its A–Z rail. Each
    // has completed visits weeks ago (never on the calendar's "today", never in
    // a slot a booking spec wants) and no team member, so Pat never sees them.
    const PAST_CLIENTS = [
        ['Amara Iipinge', 1, 100], ['Bertha Nangombe', 2, 100], ['Dawid Botha', 1, 150],
        ['Hilma Shikongo', 2, 150], ['Johannes Amukoto', 3, 100], ['Martha Nghidinwa', 1, 250],
        ['Petrus Hamutenya', 2, 100], ['Saara Kapolo', 3, 120], ['Zacharias Uushona', 1, 100],
    ];
    for (const [i, [name, visits, price]] of PAST_CLIENTS.entries()) {
        const client = await User.create({
            name, email: `e2e-client-${i}@bookplus.dev`, password: 'Password1!',
            phone: `+26481100${String(i).padStart(4, '0')}`, role: 'customer', isVerified: true, provider: 'local',
        });
        for (let v = 0; v < visits; v += 1) {
            const day = new Date(today); day.setDate(day.getDate() - (20 + i * 3 + v * 7));
            await Appointment.create({
                service: service._id, provider: provider._id, customer: client._id,
                appointmentDate: day, startTime: '08:00', endTime: '08:30', status: 'completed', totalPrice: price,
            });
        }
    }

    // One email holding BOTH a customer and a business account (same password),
    // for the login destination-chooser and cross-app hand-off specs.
    await User.create({
        name: 'E2E Dual', email: 'e2e-dual@bookplus.dev', password: 'Password1!',
        phone: '+264810000003', role: 'customer', isVerified: true, provider: 'local',
    });
    await User.create({
        name: 'E2E Dual', email: 'e2e-dual@bookplus.dev', password: 'Password1!',
        phone: '+264810000003', role: 'provider', providerCategory: 'Home services',
        isVerified: true, provider: 'local', providerSetupComplete: true,
    });

    // The same, but with a DIFFERENT password on each side — the shape the
    // product itself produces (registration and password reset are both
    // per-side) and the one that used to make the chooser vanish. The website
    // must still offer the choice here; it just can't carry the session across.
    await User.create({
        name: 'E2E Split', email: 'e2e-split@bookplus.dev', password: 'Password1!',
        phone: '+264810000004', role: 'customer', isVerified: true, provider: 'local',
    });
    await User.create({
        name: 'E2E Split', email: 'e2e-split@bookplus.dev', password: 'Different1!',
        phone: '+264810000004', role: 'provider', providerCategory: 'Home services',
        isVerified: true, provider: 'local', providerSetupComplete: true,
    });

    // The admin console's login (business app /bkplus-command) — admin-panel.spec.
    await User.create({
        name: 'E2E Admin', email: 'e2e-admin@bookplus.dev', password: 'Password1!',
        phone: '+264810000099', role: 'admin', isVerified: true, provider: 'local',
    });

    const app = require('./server');
    app.locals.e2e = {
        providerId: provider._id.toString(),
        serviceId: service._id.toString(),
        customerId: customer._id.toString(),
    };

    // Test-only controls, on an outer app that exists ONLY in this e2e server
    // (never in server.js): read the outbox, and move a member's invites back
    // in time to exercise the resend throttle and 7-day expiry without waiting.
    const express = require('express');
    const outer = express();
    outer.use('/__e2e', express.json());
    outer.get('/__e2e/outbox', (req, res) => {
        const to = String(req.query.to || '').toLowerCase();
        res.json(outbox.filter((m) => !to || String(m.args[0] || '').toLowerCase() === to));
    });
    outer.post('/__e2e/invites/age', async (req, res) => {
        const { email, ms = 0, expire = false } = req.body || {};
        const u = await User.findOne({ email: String(email).toLowerCase(), role: 'staff' }).select('+staffInvites +inviteRequestLog');
        if (!u) return res.status(404).json({ ok: false });
        u.staffInvites = (u.staffInvites || []).map((e) => ({
            ...e.toObject(),
            sentAt: new Date(e.sentAt.getTime() - ms),
            expiresAt: expire ? new Date(Date.now() - 1000) : e.expiresAt,
        }));
        if (u.inviteRequestLog) u.inviteRequestLog = u.inviteRequestLog.map((d) => new Date(d.getTime() - ms));
        await u.save({ validateBeforeSave: false });
        return res.json({ ok: true, count: u.staffInvites.length });
    });
    // Stand in for Google on a FIRST-TIME "Continue with Google": park a Google
    // profile exactly as passport.js does and hand back the one-time code the
    // real callback would put in /auth/callback?signup=<code>.
    outer.post('/__e2e/google-pending', async (req, res) => {
        const crypto = require('crypto');
        const PendingSignup = require('./src/models/PendingSignup');
        const { email, name = 'Gina Google', role = 'customer' } = req.body || {};
        const code = crypto.randomBytes(32).toString('hex');
        await PendingSignup.create({
            codeHash: crypto.createHash('sha256').update(code).digest('hex'),
            googleId: `e2e-g-${Date.now()}`, email: String(email).toLowerCase(), name, role,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        });
        res.json({ code });
    });
    // A fresh business for the slot-overlap spec (customer e2e), built on demand
    // for the day the spec will pick, so it never touches the seeded business
    // the other specs book. A 2-hour Braids service; Tino works 08:00–18:00 (the
    // business's hours, as hours of his own) and already has a 15:00–16:00 booking that day; Selma works
    // only 13:00–16:00 (the owner's screenshot).
    let overlapSeq = 0;
    outer.post('/__e2e/overlap-fixture', async (req, res) => {
        const StaffAvailability = require('./src/models/StaffAvailability');
        const { date } = req.body || {};
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return res.status(400).json({ ok: false });
        overlapSeq += 1;
        const owner = await User.create({
            name: 'Overlap Studio', email: `e2e-overlap-${overlapSeq}-${Date.now()}@bookplus.dev`, password: 'Password1!',
            phone: '+264810000009', role: 'provider', providerCategory: 'Home services',
            isVerified: true, provider: 'local', providerSetupComplete: true,
        });
        const braids = await Service.create({
            name: 'Braids', description: 'Two hours', price: 900, duration: 120,
            provider: owner._id, createdBy: owner._id, isActive: true, location: 'Windhoek',
        });
        const trim = await Service.create({
            name: 'Trim', description: 'One hour', price: 150, duration: 60,
            provider: owner._id, createdBy: owner._id, isActive: true, location: 'Windhoek',
        });
        const open = { enabled: true, slots: [{ start: '08:00', end: '18:00' }] };
        await Availability.create({
            provider: owner._id,
            schedule: { monday: open, tuesday: open, wednesday: open, thursday: open, friday: open, saturday: open, sunday: open },
        });
        const [tino, selma] = await TeamMember.create([
            { provider: owner._id, name: 'Tino Booked', role: 'Braider', offersAllServices: true },
            { provider: owner._id, name: 'Selma Afternoons', role: 'Braider', offersAllServices: true },
        ]);
        const afternoon = { enabled: true, slots: [{ start: '13:00', end: '16:00' }] };
        // Hours of their own for both — a member with none can't be booked.
        await StaffAvailability.create([
            {
                provider: owner._id, teamMember: tino._id,
                schedule: { monday: open, tuesday: open, wednesday: open, thursday: open, friday: open, saturday: open, sunday: open },
            },
            {
                provider: owner._id, teamMember: selma._id,
                schedule: { monday: afternoon, tuesday: afternoon, wednesday: afternoon, thursday: afternoon, friday: afternoon, saturday: afternoon, sunday: afternoon },
            },
        ]);
        await Appointment.create({
            service: trim._id, provider: owner._id, teamMember: tino._id, walkInName: 'Existing Client',
            appointmentDate: new Date(`${date}T00:00:00.000Z`), startTime: '15:00', endTime: '16:00',
            status: 'confirmed', totalPrice: 150,
        });
        res.json({ providerId: String(owner._id), serviceId: String(braids._id), tino: String(tino._id), selma: String(selma._id) });
    });
    // A fresh business for the lone-member spec (business e2e): the owner's
    // report — "Moses didn't set blocked times but he's getting the times of the
    // business owner". The business (the owner) is CLOSED on `date`'s weekday;
    // Moses, its only team member, works 09:00–17:00 every day of his own; and
    // the owner has an old "business-wide" block (ownerOnly false) that day.
    let loneSeq = 0;
    outer.post('/__e2e/lone-member-fixture', async (req, res) => {
        const StaffAvailability = require('./src/models/StaffAvailability');
        const BlockedTime = require('./src/models/BlockedTime');
        const { date } = req.body || {};
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return res.status(400).json({ ok: false });
        loneSeq += 1;
        const email = `e2e-lone-${loneSeq}-${Date.now()}@bookplus.dev`;
        const owner = await User.create({
            name: 'Lone Owner', email, password: 'Password1!',
            phone: '+264810000010', role: 'provider', providerCategory: 'Home services',
            isVerified: true, provider: 'local', providerSetupComplete: true,
        });
        await Service.create({
            name: 'Cut', description: 'One hour', price: 150, duration: 60,
            provider: owner._id, createdBy: owner._id, isActive: true, location: 'Windhoek',
        });
        const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const closedDay = DAYS[new Date(`${date}T00:00:00.000Z`).getUTCDay()];
        const open = { enabled: true, slots: [{ start: '08:00', end: '18:00' }] };
        const schedule = Object.fromEntries(DAYS.map((d) => [d, d === closedDay ? { enabled: false, slots: [] } : open]));
        await Availability.create({ provider: owner._id, schedule });
        const moses = await TeamMember.create({ provider: owner._id, name: 'Moses Hamalwa', role: 'Barber', offersAllServices: true });
        const own = { enabled: true, slots: [{ start: '09:00', end: '17:00' }] };
        await StaffAvailability.create({
            provider: owner._id, teamMember: moses._id,
            schedule: Object.fromEntries(DAYS.map((d) => [d, own])),
        });
        await BlockedTime.create({
            provider: owner._id, teamMember: null, ownerOnly: false,
            date, startTime: '12:00', endTime: '13:00', reason: 'Owner errand',
        });
        res.json({ email, password: 'Password1!', providerId: String(owner._id), moses: String(moses._id) });
    });
    // A fresh business for the admin-panel spec (business e2e), built on demand
    // so suspending / crediting it never touches the seeded business the other
    // specs book: one bookable service, open every day, a GUEST booking far in
    // the future (so it heads the admin table, which is newest-date first), a
    // no-show booking, NO platform wallet row, and a client account the spec
    // makes an admin and back.
    let adminSeq = 0;
    outer.post('/__e2e/admin-fixture', async (req, res) => {
        adminSeq += 1;
        const tag = `${adminSeq}-${Date.now()}`;
        const businessName = `Admin Fixture Salon ${adminSeq}`;
        const owner = await User.create({
            name: `Fixture Owner ${adminSeq}`, email: `e2e-adminfx-${tag}@bookplus.dev`, password: 'Password1!',
            phone: '+264810000011', role: 'provider', providerCategory: 'Home services',
            isVerified: true, provider: 'local', providerSetupComplete: true,
            businessProfile: { businessName },
        });
        const svc = await Service.create({
            name: 'Fixture Cut', description: 'Half an hour', price: 90, duration: 30,
            provider: owner._id, createdBy: owner._id, isActive: true, location: 'Windhoek',
        });
        const open = { enabled: true, slots: [{ start: '08:00', end: '18:00' }] };
        await Availability.create({
            provider: owner._id,
            schedule: { monday: open, tuesday: open, wednesday: open, thursday: open, friday: open, saturday: open, sunday: open },
        });
        const far = new Date(); far.setHours(0, 0, 0, 0); far.setDate(far.getDate() + 700 + adminSeq);
        const guestName = `Gina Guest ${adminSeq}`;
        await Appointment.create({
            service: svc._id, provider: owner._id, guestName, guestEmail: `gina-${tag}@guest.test`,
            appointmentDate: far, startTime: '09:00', endTime: '09:30', status: 'confirmed', totalPrice: 90,
        });
        const past = new Date(); past.setHours(0, 0, 0, 0); past.setDate(past.getDate() - 3);
        const noShowName = `Nolan NoShow ${adminSeq}`;
        await Appointment.create({
            service: svc._id, provider: owner._id, walkInName: noShowName,
            appointmentDate: past, startTime: '11:00', endTime: '11:30', status: 'no-show', totalPrice: 90,
        });
        const client = await User.create({
            name: `Promo Client ${adminSeq}`, email: `e2e-promo-${tag}@bookplus.dev`, password: 'Password1!',
            phone: '+264810000012', role: 'customer', isVerified: true, provider: 'local',
        });
        res.json({
            providerId: String(owner._id), ownerName: owner.name, ownerEmail: owner.email, businessName,
            guestName, noShowName, clientName: client.name, clientEmail: client.email,
        });
    });
    outer.use(app);

    outer.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(`E2E API (in-memory Mongo) listening on ${PORT}`);
    });

    const shutdown = async () => {
        await mongoose.connection.close().catch(() => {});
        await mem.stop().catch(() => {});
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
})().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('E2E server failed to start:', err);
    process.exit(1);
});
