process.env.NODE_ENV = 'test';
process.env.TZ = 'Asia/Tashkent';
process.env.PORT = '5999';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.BOT_API_SECRET = 'test-bot-secret';
process.env.ADMIN_ID = '9999';
process.env.HEMIS_API_BASE = 'https://hemis.test';
process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-bot-token';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/test';

global.fetch = async () => {
    throw new Error('Unexpected fetch call. Mock global.fetch in this test.');
};
