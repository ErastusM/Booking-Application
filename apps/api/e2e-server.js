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
    const [alex] = await TeamMember.create([
        { provider: provider._id, name: 'Alex Rivera', role: 'Specialist', color: '#3B82F6' },
        { provider: provider._id, name: 'Billie Chen', role: 'Technician', color: '#10B981' },
    ]);
    // Both members are left WITHOUT an explicit StaffAvailability on purpose: a
    // member with none inherits the business hours (staffHoursReason falls back to
    // businessSchedule), so the person-first customer flow can still book them —
    // while the business team-management spec relies on Alex inheriting to exercise
    // its "Set custom hours" toggle.
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
