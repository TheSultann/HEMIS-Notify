// Backend/routes/bot.js

const express = require('express');
const router = express.Router();
const User = require('../models/User');
// Импортируем сервисные функции из роута расписания
const scheduleRouter = require('./schedule');
const scheduleService = scheduleRouter.scheduleService;

// Промежуточное ПО для защиты роутов бота
const protectBotRoute = (req, res, next) => {
    const secret = req.headers['x-bot-secret'];
    if (secret && secret === process.env.BOT_API_SECRET) {
        next();
    } else {
        res.status(401).json({ message: 'Unauthorized' });
    }
};

// POST /api/bot/link-account (этот эндпоинт у вас уже есть)
router.post('/link-account', protectBotRoute, async (req, res) => {
    const { email, password, chatId } = req.body;
    if (!email || !password || !chatId) {
        return res.status(400).json({ message: 'Email, password, and chatId are required' });
    }
    try {
        const user = await User.findOne({ email });
        if (user && (await user.matchPassword(password))) {
            const existingLink = await User.findOne({ telegramChatId: chatId });
            if (existingLink && existingLink.email !== email) {
                return res.status(409).json({ message: 'This Telegram account is already linked to another user.' });
            }
            user.telegramChatId = chatId;
            await user.save();
            res.status(200).json({ success: true, message: 'Account linked successfully.' });
        } else {
            res.status(401).json({ message: 'Invalid email or password' });
        }
    } catch (error) {
        console.error('Bot link account error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// НОВЫЙ ЭНДПОИНТ: GET /api/bot/subscribers
// Возвращает ID всех пользователей, привязавших Telegram
router.get('/subscribers', protectBotRoute, async (req, res) => {
    try {
        const subscribers = await User.find({ telegramChatId: { $ne: null } }).select('telegramChatId -_id');
        const chatIds = subscribers.map(sub => sub.telegramChatId);
        res.json(chatIds);
    } catch (error) {
        console.error('Get subscribers error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// НОВЫЙ ЭНДПОИНТ: GET /api/bot/schedule/:chatId
// Получает полное расписание для пользователя по его ID чата
router.get('/schedule/:chatId', protectBotRoute, async (req, res) => {
    try {
        const { chatId } = req.params;
        const user = await User.findOne({ telegramChatId: chatId });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Используем ту же логику, что и в основном роуте расписания
        let hemisToken = user.hemisToken;
        if (!hemisToken) {
            hemisToken = await scheduleService.loginToHemis(user.hemisLogin, user.hemisPassword, user._id);
        }
        if (!hemisToken) return res.status(401).json({ message: 'Failed to authenticate with HEMIS' });

        const semesterCode = await scheduleService.getCurrentSemester(hemisToken);
        if (!semesterCode) return res.status(400).json({ message: 'Could not determine semester' });

        let scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, semesterCode);

        // Обработка просроченного токена
        if (scheduleResult?.error === 'unauthorized') {
            hemisToken = await scheduleService.loginToHemis(user.hemisLogin, user.hemisPassword, user._id);
            scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, semesterCode);
        }

        if (scheduleResult === null || scheduleResult?.error) {
            return res.status(500).json({ message: 'Failed to fetch schedule from HEMIS' });
        }

        res.json(scheduleResult);

    } catch (error) {
        console.error('Get schedule for bot error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;