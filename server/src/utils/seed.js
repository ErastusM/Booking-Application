require('dotenv').config({ path: '../../.env' });
const mongoose = require('mongoose');
const Service = require('../models/Service');
const User = require('../models/User');

const connectDB = async () => {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/barbershop');
    console.log('MongoDB connected');
};

const services = [
    {
        name: 'Classic Haircut',
        description: 'A clean, classic haircut tailored to your style and face shape.',
        price: 25,
        duration: 30,
    },
    {
        name: 'Beard Trim',
        description: 'Professional beard shaping and trimming for a sharp, clean look.',
        price: 15,
        duration: 20,
    },
    {
        name: 'Haircut & Beard Combo',
        description: 'Full haircut plus beard trim — the complete grooming package.',
        price: 35,
        duration: 50,
    },
    {
        name: 'Hot Towel Shave',
        description: 'Traditional straight razor shave with hot towel treatment.',
        price: 30,
        duration: 40,
    },
    {
        name: 'Kids Haircut',
        description: 'Gentle, fun haircuts for children under 12.',
        price: 18,
        duration: 25,
    },
    {
        name: 'Hair Wash & Style',
        description: 'Shampoo, condition, blow-dry and style.',
        price: 20,
        duration: 30,
    },
];

const seed = async () => {
    try {
        await connectDB();

        // Find or create an admin user to be the creator of services
        let admin = await User.findOne({ role: 'admin' });

        if (!admin) {
            admin = await User.create({
                name: 'Admin',
                email: 'admin@barbershop.com',
                password: 'admin123',
                phone: '0000000000',
                role: 'admin',
            });
            console.log('Admin user created — email: admin@barbershop.com, password: admin123');
        }

        // Clear existing services
        await Service.deleteMany({});
        console.log('Existing services cleared');

        // Insert services with admin as creator
        const servicesWithCreator = services.map(s => ({ ...s, createdBy: admin._id }));
        await Service.insertMany(servicesWithCreator);
        console.log(`${services.length} services seeded successfully`);

        mongoose.disconnect();
        console.log('Done!');
    } catch (error) {
        console.error('Seed error:', error.message);
        mongoose.disconnect();
    }
};

seed();