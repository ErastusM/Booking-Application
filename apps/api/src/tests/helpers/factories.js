const User = require('../../models/User');
const Service = require('../../models/Service');
const Appointment = require('../../models/Appointment');
const Review = require('../../models/Review');
const { generateToken } = require('../../utils/helpers');

let _counter = 0;
const uid = () => ++_counter;

exports.makeUser = async (overrides = {}) => {
    const n = uid();
    const defaults = {
        name: overrides.name || `User ${n}`,
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
        providerCategory: 'Beauty & Grooming',
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

exports.tokenFor = (user) => generateToken(user._id, user.tokenVersion || 0);

exports.authHeader = (user) => ({ Authorization: `Bearer ${exports.tokenFor(user)}` });
