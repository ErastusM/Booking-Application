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
// E2E must never attempt real email delivery — disable SMTP before the app loads.
delete process.env.EMAIL_USER;
delete process.env.EMAIL_PASS;
const PORT = process.env.PORT || 5050;

(async () => {
    const mem = await MongoMemoryServer.create();
    const uri = mem.getUri();
    await mongoose.connect(uri);

    const User = require('./src/models/User');
    const Service = require('./src/models/Service');
    const Availability = require('./src/models/Availability');

    // Seed a verified provider with a bookable service + full weekday availability
    const provider = await User.create({
        name: 'E2E Barber', email: 'e2e-provider@bookplus.invalid', password: 'Password1!',
        phone: '+264810000000', role: 'provider', providerCategory: 'Beauty & Grooming',
        isVerified: true, provider: 'local',
    });
    const service = await Service.create({
        name: 'E2E Haircut', description: 'A test haircut', price: 100, duration: 30,
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
        name: 'E2E Customer', email: 'e2e-customer@bookplus.invalid', password: 'Password1!',
        phone: '+264810000001', role: 'customer', isVerified: true, provider: 'local',
    });

    const app = require('./server');
    app.locals.e2e = {
        providerId: provider._id.toString(),
        serviceId: service._id.toString(),
        customerId: customer._id.toString(),
    };

    app.listen(PORT, () => {
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
