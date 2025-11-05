const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Group = require('../models/Group');
const scheduleRouter = require('./schedule');
const scheduleService = scheduleRouter.scheduleService;
const { encrypt, decrypt } = require('../utils/crypto');

const protectBotRoute = (req, res, next) => {
    const secret = req.headers['x-bot-secret'];
    if (secret && secret === process.env.BOT_API_SECRET) {
        next();
    } else {
        res.status(401).json({ message: 'Unauthorized' });
    }
};

// ... (роуты /register, /bind-group, /groups, /subscribers без изменений) ...

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
        const encryptedPassword = encrypt(hemisPassword);

        let user = await User.findOne({ telegramChatId: chatId });

        if (user) {
            user.hemisLogin = hemisLogin;
            user.hemisPassword = encryptedPassword;
            user.hemisToken = hemisToken;
            user.fullName = profileData.fullName;
            user.role = profileData.isStudent ? 'student' : 'teacher';
            user.group = profileData.groupName;
        } else {
            user = new User({
                hemisLogin,
                hemisPassword: encryptedPassword,
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
        if (error.code === 11000) {
            console.error('Bot register error: Duplicate key violation.', error.keyValue);
            return res.status(409).json({ message: 'A user with this login or chat ID might already exist.' });
        }
        console.error('Bot register error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/bind-group', protectBotRoute, async (req, res) => {
    const { groupName, chatId } = req.body;
    if (!groupName || !chatId) {
        return res.status(400).json({ message: 'Group Name and Chat ID are required' });
    }

    try {
        const studentInGroup = await User.findOne({ group: groupName });
        if (!studentInGroup) {
            return res.status(404).json({ message: `Сначала хотя бы один студент из группы "${groupName}" должен привязать свой аккаунт к боту.` });
        }

        let group = await Group.findOne({ telegramChatId: chatId });
        if (group) {
            group.groupName = groupName;
        } else {
            const existingGroupByName = await Group.findOne({ groupName });
            if (existingGroupByName) {
                return res.status(409).json({ message: `Группа "${groupName}" уже привязана к другому чату.` });
            }
            group = new Group({ groupName, telegramChatId: chatId });
        }
        
        await group.save();
        res.status(200).json({ success: true, message: `Группа "${groupName}" успешно привязана к этому чату.` });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: 'Этот чат или название группы уже используются.' });
        }
        console.error('Bind group error:', error);
        res.status(500).json({ message: 'Ошибка сервера при привязке группы' });
    }
});

router.get('/groups', protectBotRoute, async (req, res) => {
    try {
        const groups = await Group.find().select('telegramChatId groupName -_id');
        res.json(groups);
    } catch (error) {
        console.error('Get groups error:', error);
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

// --- ОБЩАЯ ФУНКЦИЯ ДЛЯ ПОЛУЧЕНИЯ РАСПИСАНИЯ ГРУППЫ ---
async function getGroupSchedule(groupName) {
    const user = await User.findOne({ group: groupName });
    if (!user) {
        throw { status: 404, message: `Не найден зарегистрированный студент для группы ${groupName}.` };
    }

    const plainPassword = decrypt(user.hemisPassword);
    let hemisToken = user.hemisToken;

    if (!hemisToken) {
        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
        if (!authData) throw { status: 401, message: 'Ошибка аутентификации HEMIS от имени участника группы' };
        hemisToken = authData.token;
        user.hemisToken = hemisToken;
        await user.save();
    }
    
    const semesterCode = await scheduleService.getCurrentSemester(hemisToken);
    if (!semesterCode) {
        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
        if (!authData) throw { status: 401, message: 'Ошибка повторной аутентификации в HEMIS' };
        hemisToken = authData.token;
        user.hemisToken = hemisToken;
        await user.save();
        const newSemesterCode = await scheduleService.getCurrentSemester(hemisToken);
        if(!newSemesterCode) throw { status: 400, message: 'Не удалось определить семестр.' };
        
        const scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, newSemesterCode);
        return { schedule: scheduleResult, role: 'student' };
    }

    let scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, semesterCode);

    if (scheduleResult?.error === 'unauthorized') {
        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
        if (!authData) throw { status: 401, message: 'Ошибка повторной аутентификации в HEMIS' };
        hemisToken = authData.token;
        user.hemisToken = hemisToken;
        await user.save();
        scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, semesterCode);
    }

    if (scheduleResult === null || scheduleResult?.error) {
        throw { status: 500, message: 'Не удалось получить расписание из HEMIS' };
    }
    
    return { schedule: scheduleResult, role: 'student' };
}

router.get('/schedule/group/:groupName', protectBotRoute, async (req, res) => {
    try {
        const { groupName } = req.params;
        const result = await getGroupSchedule(groupName);
        res.json(result);
    } catch (error) {
        console.error(`Get schedule for group ${req.params.groupName} error:`, error.message || error);
        res.status(error.status || 500).json({ message: error.message || 'Server error' });
    }
});

// --- НОВЫЙ ЭНДПОИНТ: Получение расписания группы по ID чата ---
router.get('/schedule/group-by-chat-id/:chatId', protectBotRoute, async (req, res) => {
    try {
        const { chatId } = req.params;
        const group = await Group.findOne({ telegramChatId: chatId });
        if (!group) {
            return res.status(404).json({ message: 'Этот чат не привязан к академической группе.' });
        }
        const result = await getGroupSchedule(group.groupName);
        // Добавляем имя группы в ответ, чтобы бот мог его использовать
        res.json({ ...result, groupName: group.groupName });
    } catch (error) {
        console.error(`Get schedule for group chat ${req.params.chatId} error:`, error.message || error);
        res.status(error.status || 500).json({ message: error.message || 'Server error' });
    }
});

router.get('/schedule/:chatId', protectBotRoute, async (req, res) => {
    try {
        const { chatId } = req.params;
        const user = await User.findOne({ telegramChatId: chatId });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const plainPassword = decrypt(user.hemisPassword);

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
            console.log("Could not get semester, trying to re-login to HEMIS...");
            const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
            if (!authData) return res.status(401).json({ message: 'Failed to re-authenticate with HEMIS' });
            hemisToken = authData.token;
            user.hemisToken = hemisToken;
            await user.save();
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