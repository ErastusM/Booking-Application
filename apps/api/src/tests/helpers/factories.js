const User = require('../../models/User');
const Service = require('../../models/Service');
const Appointment = require('../../models/Appointment');
const Review = require('../../models/Review');
const StaffAvailability = require('../../models/StaffAvailability');
const { generateToken } = require('../../utils/helpers');

let _counter = 0;
const uid = () => ++_counter;

exports.makeUser = async (overrides = {}) => {
    const n = uid();
    const defaults = {
        name: overrides.name || `Test User${n}`,
        email: overrides.email || `user${n}@test.com`,
        password: 'Password1!',
        phone: '+15550001000',
        role: 'customer',
        isVerified: true,
        provider: 'local',
    };
    return User.create({ ...defaults, ...overrides });
};

exports.makeProvider = async (overrides = {}) => {
    const n = uid();
    return User.create({
        name: `Provider ${n}`,
        email: `provider${n}@test.com`,
        password: 'Password1!',
        phone: '+15550002000',
        role: 'provider',
        providerCategory: 'Home services',
        isVerified: true,
        provider: 'local',
        ...overrides,
    });
};

exports.makeAdmin = async (overrides = {}) => {
    const n = uid();
    return User.create({
        name: `Admin ${n}`,
        email: `admin${n}@test.com`,
        password: 'Password1!',
        phone: '+15550003000',
        role: 'admin',
        isVerified: true,
        provider: 'local',
        ...overrides,
    });
};

exports.makeService = async (providerId, overrides = {}) => {
    const n = uid();
    return Service.create({
        name: overrides.name || `Service ${n}`,
        description: 'A test service',
        price: 50,
        duration: 30,
        provider: providerId,
        createdBy: providerId,
        isActive: true,
        location: 'Nairobi',
        ...overrides,
    });
};

exports.makeAppointment = async (customerId, serviceId, providerId, overrides = {}) => {
    // 3 days out, not tomorrow: "tomorrow at 10:00" sits inside the default
    // 24h cancellation window when tests run after 10:00, making every
    // cancel/reschedule test flaky by time of day.
    const upcoming = new Date();
    upcoming.setDate(upcoming.getDate() + 3);
    return Appointment.create({
        customer: customerId,
        service: serviceId,
        provider: providerId,
        appointmentDate: upcoming,
        startTime: '10:00',
        endTime: '10:30',
        totalPrice: 50,
        status: 'pending',
        ...overrides,
    });
};

exports.makeReview = async (customerId, serviceId, appointmentId, overrides = {}) => {
    return Review.create({
        customer: customerId,
        service: serviceId,
        appointment: appointmentId,
        rating: 4,
        comment: 'Great service!',
        ...overrides,
    });
};

// A weekly schedule with the same period every day, e.g. everyDayHours('08:00', '18:00').
exports.everyDayHours = (start = '00:00', end = '23:59') => Object.fromEntries(
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        .map((d) => [d, { enabled: true, slots: [{ start, end }] }])
);

/**
 * Give a team member working hours of their own. Nothing is inherited from the
 * business's hours: a member with no hours of their own can't be booked (the
 * owner's decision), so any test that books a member needs this. The default —
 * every day, all day — leaves the business's hours, blocks and bookings as the
 * only limits, which is what a test not ABOUT hours wants.
 */
exports.giveHours = (member, schedule = exports.everyDayHours()) => StaffAvailability.create({
    provider: member.provider, teamMember: member._id, schedule,
});

exports.tokenFor = (user) => generateToken(user._id, user.tokenVersion || 0);

exports.authHeader = (user) => ({ Authorization: `Bearer ${exports.tokenFor(user)}` });
