/**
 * In-memory MongoDB helper for all tests.
 * Uses mongodb-memory-server so no real DB is touched.
 *
 * Because Jest runs test files in the same process (--runInBand) and Mongoose
 * maintains a singleton connection, we only start one MongoMemoryServer and
 * connect once. Subsequent calls to connect() are no-ops if already connected.
 */
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

exports.connect = async () => {
    // Already connected to an in-memory server — skip
    if (mongoose.connection.readyState === 1 && mongod) return;

    // If mongoose is connected to something else (shouldn't happen in tests), disconnect first
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }

    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), {
        serverSelectionTimeoutMS: 5000,
    });
};

exports.closeDatabase = async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    if (mongod) {
        await mongod.stop();
        mongod = undefined;
    }
};

exports.clearDatabase = async () => {
    if (mongoose.connection.readyState !== 1) return;
    const collections = mongoose.connection.collections;
    for (const key in collections) {
        await collections[key].deleteMany({});
    }
};

