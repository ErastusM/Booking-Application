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
    const providerData = [
        {
            name: 'Marcus N.',
            email: 'marcus@bookplus.com',
            phone: '0811234567',
            password: 'Admin123!',
            role: 'provider',
            isVerified: true,
            avatar: null,
            location: 'Windhoek Central',
        },
        {
            name: 'James Styles',
            email: 'james@bookplus.com',
            phone: '0812345678',
            password: 'Admin123!',
            role: 'provider',
            isVerified: true,
            avatar: null,
            location: 'Klein Windhoek',
        },
        {
            name: 'David Cuts',
            email: 'david@bookplus.com',
            phone: '0813456789',
            password: 'Admin123!',
            role: 'provider',
            isVerified: true,
            avatar: null,
            location: 'Katutura',
        },
        {
            name: 'Sam K.',
            email: 'sam@bookplus.com',
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
    const providerServices = [
        {
            provider: providers[0], // Marcus — Windhoek Central
            categories: [
                {
                    name: 'Haircuts',
                    services: [
                        { name: 'Classic Haircut', description: 'Clean, precise haircut tailored to your style.', price: 120, duration: 30 },
                        { name: 'Fade Cut', description: 'Sharp fade from skin to length with clean lines.', price: 150, duration: 45 },
                        { name: 'Kids Haircut', description: 'Fun, gentle haircut for children under 12.', price: 80, duration: 25 },
                    ],
                },
                {
                    name: 'Beard',
                    services: [
                        { name: 'Beard Trim', description: 'Shape and trim your beard to perfection.', price: 80, duration: 20 },
                        { name: 'Beard Design', description: 'Custom beard design and sharp lines.', price: 120, duration: 30 },
                    ],
                },
                {
                    name: 'Combos',
                    services: [
                        { name: 'Cut & Beard Combo', description: 'Full haircut plus beard trim and shape.', price: 180, duration: 60 },
                    ],
                },
            ],
        },
        {
            provider: providers[1], // James — Klein Windhoek
            categories: [
                {
                    name: 'Premium Cuts',
                    services: [
                        { name: 'Signature Cut', description: 'James\'s signature style cut with consultation.', price: 250, duration: 60 },
                        { name: 'Low Taper Fade', description: 'Clean low taper with sharp edges.', price: 200, duration: 45 },
                        { name: 'High Top Fade', description: 'Bold high top with precise fade.', price: 220, duration: 50 },
                    ],
                },
                {
                    name: 'Treatments',
                    services: [
                        { name: 'Hot Towel Shave', description: 'Traditional straight razor shave with hot towel.', price: 180, duration: 40 },
                        { name: 'Scalp Treatment', description: 'Deep conditioning scalp massage and treatment.', price: 150, duration: 35 },
                    ],
                },
            ],
        },
        {
            provider: providers[2], // David — Katutura
            categories: [
                {
                    name: 'Cuts',
                    services: [
                        { name: 'Regular Cut', description: 'Affordable, clean cut for any style.', price: 60, duration: 25 },
                        { name: 'Shape Up', description: 'Edge up and shape up for a clean look.', price: 50, duration: 15 },
                        { name: 'Skin Fade', description: 'Smooth skin fade with your choice of length on top.', price: 90, duration: 35 },
                    ],
                },
                {
                    name: 'Beard',
                    services: [
                        { name: 'Beard Line Up', description: 'Sharp beard line up and neck cleanup.', price: 40, duration: 15 },
                        { name: 'Full Beard Groom', description: 'Complete beard wash, trim and oil treatment.', price: 70, duration: 25 },
                    ],
                },
                {
                    name: 'Specials',
                    services: [
                        { name: 'Student Special', description: 'Cut + shape up at a discounted student rate.', price: 80, duration: 35 },
                    ],
                },
            ],
        },
        {
            provider: providers[3], // Sam — Eros
            categories: [
                {
                    name: 'Haircuts',
                    services: [
                        { name: 'Executive Cut', description: 'Professional cut for the working gentleman.', price: 160, duration: 40 },
                        { name: 'Textured Crop', description: 'Modern textured crop with fade.', price: 170, duration: 45 },
                        { name: 'Caesar Cut', description: 'Classic Caesar cut with clean edges.', price: 140, duration: 35 },
                    ],
                },
                {
                    name: 'Grooming',
                    services: [
                        { name: 'Full Groom Package', description: 'Cut, beard, eyebrow trim and hot towel finish.', price: 280, duration: 90 },
                        { name: 'Eyebrow Trim', description: 'Clean eyebrow shaping and trim.', price: 50, duration: 15 },
                        { name: 'Hair Wash & Style', description: 'Shampoo, condition, blow dry and style.', price: 100, duration: 30 },
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