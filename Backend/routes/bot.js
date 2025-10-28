// Backend/routes/bot.js

const express = require('express');
const router = express.Router();
const User = require('../models/User');
// УБРАЛИ: const { encrypt, decrypt } = require('../utils/crypto');
const scheduleRouter = require('./schedule');
const scheduleService = scheduleRouter.scheduleService;

const protectBotRoute = (req, res, next) => {
    const secret = req.headers['x-bot-secret'];
    if (secret && secret === process.env.BOT_API_SECRET) {
        next();
    } else {
        res.status(401).json({ message: 'Unauthorized' });
    }
};

router.post('/register', protectBotRoute, async (req, res) => {
    const { hemisLogin, hemisPassword, chatId } = req.body;
    if (!hemisLogin || !hemisPassword || !chatId) {
        return res.status(400).json({ message: 'HEMIS Login, Password, and ChatId are required' });
    }

    try {
        const hemisAuthData = await scheduleService.performHemisLogin(hemisLogin, hemisPassword);
        if (!hemisAuthData || !hemisAuthData.token) {
            return res.status(401).json({ message: 'Invalid HEMIS login or password' });
        }
        
        const { token: hemisToken, profileData } = hemisAuthData;

        let user = await User.findOne({ hemisLogin });
        if (user) {
            user.hemisPassword = hemisPassword; // <-- УПРОЩЕНО
            user.telegramChatId = chatId;
            user.hemisToken = hemisToken;
        } else {
            user = new User({
                hemisLogin,
                hemisPassword: hemisPassword, // <-- УПРОЩЕНО
                telegramChatId: chatId,
                hemisToken,
                fullName: profileData.fullName,
                role: profileData.isStudent ? 'student' : 'teacher',
                group: profileData.groupName
            });
        }
        
        await user.save();
        res.status(200).json({ success: true, message: `Welcome, ${profileData.fullName}! Account linked successfully.` });

    } catch (error) {
        console.error('Bot register error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/subscribers', protectBotRoute, async (req, res) => {
    try {
        const subscribers = await User.find({ telegramChatId: { $ne: null } }).select('telegramChatId role -_id');
        res.json(subscribers);
    } catch (error) {
        console.error('Get subscribers error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/schedule/:chatId', protectBotRoute, async (req, res) => {
    try {
        const { chatId } = req.params;
        const user = await User.findOne({ telegramChatId: chatId });
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Пароль теперь используется напрямую, без расшифровки
        const plainPassword = user.hemisPassword; // <-- УПРОЩЕНО

        let hemisToken = user.hemisToken;
        if (!hemisToken) {
            const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
            if (!authData) return res.status(401).json({ message: 'Failed to authenticate with HEMIS' });
            hemisToken = authData.token;
            user.hemisToken = hemisToken;
            await user.save();
        }
        
        const semesterCode = await scheduleService.getCurrentSemester(hemisToken);
        if (!semesterCode) {
            // Если не удалось получить семестр, возможно, токен "умер"
            console.log("Could not get semester, trying to re-login to HEMIS...");
            const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
            if (!authData) return res.status(401).json({ message: 'Failed to re-authenticate with HEMIS' });
            hemisToken = authData.token;
            user.hemisToken = hemisToken;
            await user.save();
            // Повторная попытка получить семестр
            const newSemesterCode = await scheduleService.getCurrentSemester(hemisToken);
            if(!newSemesterCode) return res.status(400).json({ message: 'Could not determine semester even after re-login.' });
            
            const scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, newSemesterCode);
            return res.json({ schedule: scheduleResult, role: user.role });
        }

        let scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, semesterCode);

        if (scheduleResult?.error === 'unauthorized') {
            const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
            if (!authData) return res.status(401).json({ message: 'Failed to re-authenticate with HEMIS' });
            hemisToken = authData.token;
            user.hemisToken = hemisToken;
            await user.save();
            scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, semesterCode);
        }

        if (scheduleResult === null || scheduleResult?.error) {
            return res.status(500).json({ message: 'Failed to fetch schedule from HEMIS' });
        }
        
        res.json({ schedule: scheduleResult, role: user.role });

    } catch (error) {
        console.error('Get schedule for bot error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;