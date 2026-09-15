const mongoose = require('mongoose');
const User = require('../models/User');
const Service = require('../models/Service');
const Category = require('../models/Category');
require('dotenv').config();

const connectDB = async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected');
};

const seed = async () => {
    await connectDB();

    // Clean up existing provider seed data
    await Category.deleteMany({});
    console.log('Cleared categories');

    // ── Create demo providers ──
    // DELIBERATELY cross-vertical. Bookplus is a universal, one-stop booking
    // platform for ANY appointment-based business, so the demo data spans
    // different industries (health/physio, tutoring, grooming, home trades)
    // rather than modelling one trade. Keep it that way — a single-vertical seed
    // makes the whole product read as if it is only for that vertical.
    const providerData = [
        {
            name: 'Dr. Lena Health & Physio',
            email: 'lena@bookplus.com',
            phone: '0811234567',
            password: 'Admin123!',
            role: 'provider',
            isVerified: true,
            avatar: null,
            location: 'Windhoek Central',
        },
        {
            name: 'BrightMind Tutoring',
            email: 'brightmind@bookplus.com',
            phone: '0812345678',
            password: 'Admin123!',
            role: 'provider',
            isVerified: true,
            avatar: null,
            location: 'Klein Windhoek',
        },
        {
            name: 'FreshFade Studio',
            email: 'freshfade@bookplus.com',
            phone: '0813456789',
            password: 'Admin123!',
            role: 'provider',
            isVerified: true,
            avatar: null,
            location: 'Katutura',
        },
        {
            name: 'QuickFix Home Services',
            email: 'quickfix@bookplus.com',
            phone: '0814567890',
            password: 'Admin123!',
            role: 'provider',
            isVerified: true,
            avatar: null,
            location: 'Eros',
        },
    ];

    const providers = [];
    for (const p of providerData) {
        let user = await User.findOne({ email: p.email });
        if (!user) {
            user = await User.create({ ...p, provider: 'local' });
            console.log(`Created provider: ${p.name}`);
        } else {
            console.log(`Provider exists: ${p.name}`);
        }
        providers.push({ ...user.toObject(), location: p.location });
    }

    // ── Create categories and services per provider ──
    // Each provider models a DIFFERENT kind of booking business on purpose.
    const providerServices = [
        {
            provider: providers[0], // Dr. Lena — Health & Physio (Windhoek Central)
            categories: [
                {
                    name: 'Physiotherapy',
                    services: [
                        { name: 'Sports Physio Session', description: 'Assessment and treatment for a sports injury or strain.', price: 350, duration: 45 },
                        { name: 'Injury Rehab Session', description: 'Guided rehabilitation exercises and hands-on therapy.', price: 400, duration: 60 },
                    ],
                },
                {
                    name: 'Massage Therapy',
                    services: [
                        { name: 'Deep Tissue Massage', description: 'Firm-pressure massage targeting tension and knots.', price: 300, duration: 60 },
                        { name: 'Relaxation Massage', description: 'Gentle full-body massage to unwind and de-stress.', price: 250, duration: 45 },
                    ],
                },
                {
                    name: 'Consultation',
                    services: [
                        { name: 'Initial Assessment', description: 'First-visit consultation and treatment plan.', price: 200, duration: 30 },
                    ],
                },
            ],
        },
        {
            provider: providers[1], // BrightMind — Tutoring (Klein Windhoek)
            categories: [
                {
                    name: 'Academic Tutoring',
                    services: [
                        { name: 'Maths Tutoring (1 hour)', description: 'One-on-one maths support for any grade.', price: 180, duration: 60 },
                        { name: 'Science Tutoring (1 hour)', description: 'Physics, chemistry or biology, tailored to the student.', price: 180, duration: 60 },
                    ],
                },
                {
                    name: 'Exam Preparation',
                    services: [
                        { name: 'Exam Prep Intensive', description: 'Focused revision and past-paper practice before exams.', price: 250, duration: 90 },
                    ],
                },
                {
                    name: 'Languages',
                    services: [
                        { name: 'English Reading Support', description: 'Reading, comprehension and writing help.', price: 150, duration: 45 },
                    ],
                },
            ],
        },
        {
            provider: providers[2], // FreshFade — Grooming (Katutura)
            categories: [
                {
                    name: 'Haircuts',
                    services: [
                        { name: 'Signature Haircut', description: 'Clean, precise haircut tailored to your style.', price: 150, duration: 45 },
                        { name: 'Kids Cut', description: 'Fun, gentle haircut for children under 12.', price: 80, duration: 25 },
                    ],
                },
                {
                    name: 'Beard',
                    services: [
                        { name: 'Beard Trim & Shape', description: 'Shape and trim your beard to perfection.', price: 80, duration: 20 },
                    ],
                },
                {
                    name: 'Combos',
                    services: [
                        { name: 'Cut & Beard Combo', description: 'Full haircut plus beard trim and shape.', price: 200, duration: 60 },
                    ],
                },
            ],
        },
        {
            provider: providers[3], // QuickFix — Home Services / trades (Eros)
            categories: [
                {
                    name: 'Plumbing',
                    services: [
                        { name: 'Plumbing Callout', description: 'On-site visit to diagnose and quote a plumbing issue.', price: 250, duration: 60 },
                        { name: 'Leak Repair', description: 'Locate and repair a leaking pipe, tap or fitting.', price: 350, duration: 90 },
                    ],
                },
                {
                    name: 'Electrical',
                    services: [
                        { name: 'Electrical Inspection', description: 'Safety inspection of wiring, outlets and the DB board.', price: 300, duration: 60 },
                        { name: 'Socket / Light Installation', description: 'Install or replace a socket, switch or light fitting.', price: 280, duration: 45 },
                    ],
                },
                {
                    name: 'Appliances',
                    services: [
                        { name: 'Appliance Repair Visit', description: 'Diagnose and repair a household appliance on site.', price: 320, duration: 60 },
                    ],
                },
            ],
        },
    ];

    // Delete old seeded services for these providers
    const providerIds = providers.map(p => p._id);
    await Service.deleteMany({ provider: { $in: providerIds } });

    for (const { provider, categories } of providerServices) {
        for (const cat of categories) {
            const category = await Category.create({
                name: cat.name,
                provider: provider._id,
            });
            console.log(`Created category: ${cat.name} for ${provider.name}`);

            for (const svc of cat.services) {
                await Service.create({
                    ...svc,
                    provider: provider._id,
                    category: category._id,
                    location: provider.location,
                    address: `${provider.location}, Windhoek`,
                    createdBy: provider._id,
                    isActive: true,
                });
            }
            console.log(`Created ${cat.services.length} services in ${cat.name}`);
        }
    }

    console.log('\n✅ Seed complete!');
    console.log('Provider credentials:');
    providerData.forEach(p => console.log(`  ${p.email} / ${p.password}`));
    mongoose.disconnect();
};

seed().catch(err => {
    console.error('Seed error:', err);
    mongoose.disconnect();
});
