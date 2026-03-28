const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is not set');
    }

    try {
        if (mongoose.connection.readyState === 1) {
            return mongoose.connection;
        }

        if (mongoose.connection.readyState === 2) {
            await mongoose.connection.asPromise();
            return mongoose.connection;
        }

        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected...');
        return mongoose.connection;
    } catch (err) {
        console.error(err.message);
        if (process.env.NODE_ENV === 'test') {
            throw err;
        }
        process.exit(1);
    }
};

module.exports = connectDB;
