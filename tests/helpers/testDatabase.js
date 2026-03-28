const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

async function startDatabase() {
    if (!mongoServer) {
        mongoServer = await MongoMemoryServer.create();
    }

    process.env.MONGO_URI = mongoServer.getUri();
    return mongoServer;
}

async function loadServerApp() {
    const app = require('../../Backend/server');
    const mongoose = require('mongoose');

    if (mongoose.connection.readyState !== 1) {
        await mongoose.connection.asPromise();
    }

    return { app, mongoose };
}

async function clearDatabase() {
    const mongoose = require('mongoose');
    const collections = mongoose.connection.collections;

    await Promise.all(
        Object.values(collections).map((collection) => collection.deleteMany({}))
    );
}

async function stopDatabase() {
    const mongoose = require('mongoose');

    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }

    if (mongoServer) {
        await mongoServer.stop();
        mongoServer = null;
    }
}

module.exports = {
    startDatabase,
    loadServerApp,
    clearDatabase,
    stopDatabase
};
