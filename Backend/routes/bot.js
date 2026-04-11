// Backend/routes/bot.js

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Group = require('../models/Group');
const scheduleService = require('../services/hemisService');
const { processAttendanceDiff } = require('../services/attendanceNotificationService');
const { sleep } = require('../services/timeService');
const { resolveUserSchedule, resolveUserAttendance } = require('../services/botAccessService');
const { encrypt, decrypt } = require('../utils/crypto');

const activeUserFilter = {
    hemisLogin: { $not: /^temp_/i }
};
const DEFAULT_RATE_LIMIT_MESSAGE = 'HEMIS временно ограничил вход. Попробуйте позже.';

function isUserRateLimited(user, now = Date.now()) {
    if (!user?.hemisRateLimitedUntil) {
        return false;
    }

    return new Date(user.hemisRateLimitedUntil).getTime() > now;
}

async function applyLoginResult(user, authData, now = Date.now()) {
    if (authData?.error === 'rate_limited') {
        if (user) {
            user.hemisRateLimitedUntil = new Date(now + (authData.retryAfterMs || 60 * 60 * 1000));
            await user.save();
        }

        return { token: null, rateLimited: true };
    }

    if (!authData?.token) {
        return { token: null, rateLimited: false };
    }

    if (user) {
        user.hemisToken = authData.token;
        user.hemisRateLimitedUntil = null;
        await user.save();
    }

    return { token: authData.token, rateLimited: false };
}

function getNbAttendanceBatchSize() {
    const configuredValue = Number(process.env.NB_ATTENDANCE_BATCH_SIZE);
    return Number.isInteger(configuredValue) && configuredValue > 0
        ? configuredValue
        : 2;
}

function getNbAttendanceBatchPauseMs() {
    const configuredValue = Number(process.env.NB_ATTENDANCE_BATCH_PAUSE_MS);
    return Number.isFinite(configuredValue) && configuredValue >= 0
        ? configuredValue
        : 1500;
}

async function processInBatches(items, worker, { batchSize, pauseMs }) {
    if (!Array.isArray(items) || items.length === 0) {
        return;
    }

    const normalizedBatchSize = Math.max(1, batchSize);
    const normalizedPauseMs = Math.max(0, pauseMs);

    for (let index = 0; index < items.length; index += normalizedBatchSize) {
        const batch = items.slice(index, index + normalizedBatchSize);
        await Promise.all(batch.map(worker));

        if (normalizedPauseMs > 0 && index + normalizedBatchSize < items.length) {
            await sleep(normalizedPauseMs);
        }
    }
}

async function getSemesterCodeForLanguage({
    hemisToken,
    userLanguage,
    semesterCodesByLanguage,
    forceRefresh = false
}) {
    if (!forceRefresh && semesterCodesByLanguage.has(userLanguage)) {
        return semesterCodesByLanguage.get(userLanguage);
    }

    const semesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
    if (semesterCode) {
        semesterCodesByLanguage.set(userLanguage, semesterCode);
    } else {
        semesterCodesByLanguage.delete(userLanguage);
    }

    return semesterCode;
}

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
        if (hemisAuthData?.error === 'rate_limited') {
            return res.status(429).json({ message: DEFAULT_RATE_LIMIT_MESSAGE });
        }

        if (!hemisAuthData || !hemisAuthData.token) {
            return res.status(401).json({ message: 'Invalid HEMIS login or password' });
        }

        const { token: hemisToken, profileData } = hemisAuthData;
        const encryptedPassword = encrypt(hemisPassword);

        // --- НОВАЯ ЛОГИКА: Сразу получаем текущие прогулы, чтобы запомнить их ---
        let initialAbsentHours = 0;
        let user = await User.findOne({ telegramChatId: chatId });
        const userLanguage = user?.language || 'ru-RU'; // Используем сохраненный язык или по умолчанию русский

        let initialSemesterCode = null;

        if (profileData.isStudent) {
            const semesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
            if (semesterCode) {
                initialSemesterCode = semesterCode;
                const attData = await scheduleService.getAttendanceFromHemis(hemisToken, semesterCode, userLanguage);
                if (attData) {
                    initialAbsentHours = attData.totalHours;
                }
            }
        }
        // ------------------------------------------------------------------------

        if (user) {
            // Проверяем, это временный пользователь (созданный при выборе языка) или уже зарегистрированный
            const isTempUser = user.hemisLogin && user.hemisLogin.startsWith('temp_');
            const existingLanguage = user.language; // Сохраняем язык

            user.hemisLogin = hemisLogin;
            user.hemisPassword = encryptedPassword;
            user.hemisToken = hemisToken;
            user.hemisRateLimitedUntil = null;
            user.fullName = profileData.fullName;
            user.role = profileData.isStudent ? 'student' : 'teacher';
            user.group = profileData.groupName;
            user.lastKnownAbsentHours = initialAbsentHours;
            user.lastSemesterCode = initialSemesterCode;

            // Сохраняем язык, если он был установлен
            if (existingLanguage) {
                user.language = existingLanguage;
            }
        } else {
            // Пользователя нет - создаем нового
            user = new User({
                hemisLogin,
                hemisPassword: encryptedPassword,
                telegramChatId: chatId,
                hemisToken,
                hemisRateLimitedUntil: null,
                fullName: profileData.fullName,
                role: profileData.isStudent ? 'student' : 'teacher',
                group: profileData.groupName,
                lastKnownAbsentHours: initialAbsentHours,
                lastSemesterCode: initialSemesterCode
                // Язык по умолчанию null - будет выбран при первом запуске
            });
        }

        await user.save();
        res.status(200).json({ success: true, message: `Welcome, ${profileData.fullName}! Account linked successfully.` });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: 'User already exists.' });
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
        const studentInGroup = await User.findOne({
            ...activeUserFilter,
            group: { $regex: groupName, $options: 'i' }
        });

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

// --- ЭНДПОИНТ: Отвязка группы (Unbind) ---
router.post('/unbind-group', protectBotRoute, async (req, res) => {
    const { chatId } = req.body;

    if (!chatId) {
        return res.status(400).json({ message: 'Chat ID is required' });
    }

    try {
        // Удаляем запись о группе по ID чата
        const deletedGroup = await Group.findOneAndDelete({ telegramChatId: chatId });

        if (!deletedGroup) {
            return res.status(404).json({ message: 'Этот чат не был привязан ни к одной группе.' });
        }

        res.status(200).json({ success: true, message: `Группа "${deletedGroup.groupName}" успешно отвязана.` });

    } catch (error) {
        console.error('Unbind group error:', error);
        res.status(500).json({ message: 'Ошибка сервера при отвязке группы' });
    }
});


// Эндпоинт для массовой проверки новых NB
router.post('/check-new-absences', protectBotRoute, async (req, res) => {
    try {
        // Ищем всех студентов, у которых есть chatID
        const students = await User.find({
            ...activeUserFilter,
            role: 'student',
            telegramChatId: { $ne: null },
            isBlocked: { $ne: true }
        });

        const notifications = [];
        const semesterCodesByLanguage = new Map();

        await processInBatches(
            students,
            async (user) => {
                try {
                    const plainPassword = decrypt(user.hemisPassword);
                    let hemisToken = user.hemisToken;
                    const userLanguage = user.language || 'ru-RU';

                    if (isUserRateLimited(user)) {
                        return;
                    }

                    let semesterCode = await getSemesterCodeForLanguage({
                        hemisToken,
                        userLanguage,
                        semesterCodesByLanguage
                    });

                    if (!semesterCode) {
                        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
                        const loginResult = await applyLoginResult(user, authData);
                        if (!loginResult.token) {
                            return;
                        }

                        hemisToken = loginResult.token;
                        semesterCode = await getSemesterCodeForLanguage({
                            hemisToken,
                            userLanguage,
                            semesterCodesByLanguage,
                            forceRefresh: true
                        });
                    }

                    if (!semesterCode) {
                        return;
                    }

                    let attData = await scheduleService.getAttendanceFromHemis(hemisToken, semesterCode, userLanguage);

                    if (attData?.error === 'unauthorized') {
                        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
                        const loginResult = await applyLoginResult(user, authData);
                        if (!loginResult.token) {
                            return;
                        }

                        hemisToken = loginResult.token;
                        semesterCode = (await getSemesterCodeForLanguage({
                            hemisToken,
                            userLanguage,
                            semesterCodesByLanguage,
                            forceRefresh: true
                        })) || semesterCode;

                        attData = await scheduleService.getAttendanceFromHemis(hemisToken, semesterCode, userLanguage);
                    } else if (attData === null) {
                        const refreshedSemesterCode = await getSemesterCodeForLanguage({
                            hemisToken,
                            userLanguage,
                            semesterCodesByLanguage,
                            forceRefresh: true
                        });

                        if (refreshedSemesterCode && refreshedSemesterCode !== semesterCode) {
                            semesterCode = refreshedSemesterCode;
                            attData = await scheduleService.getAttendanceFromHemis(hemisToken, semesterCode, userLanguage);
                        }
                    }

                    if (attData && !attData.error) {
                        await processAttendanceDiff({
                            user,
                            currentData: attData,
                            notifications,
                            semesterCode,
                            language: userLanguage
                        });
                    } else if (attData === null) {
                        console.log(`Failed to get attendance for user ${user.hemisLogin}: API returned null`);
                    }
                } catch (err) {
                    console.error(`Error checking user ${user.hemisLogin}:`, err.message);
                    await sleep(2000);
                }
            },
            {
                batchSize: getNbAttendanceBatchSize(),
                pauseMs: getNbAttendanceBatchPauseMs()
            }
        );

        res.json({ success: true, notifications });

    } catch (error) {
        console.error('Global attendance check error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/groups', protectBotRoute, async (req, res) => {
    try {
        const groups = await Group.find().select('telegramChatId groupName lastScheduleMessageId -_id');
        res.json(groups);
    } catch (error) {
        console.error('Get groups error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/group-last-schedule-message', protectBotRoute, async (req, res) => {
    const { chatId, messageId } = req.body;

    if (!chatId || !Number.isInteger(messageId)) {
        return res.status(400).json({ message: 'Chat ID and integer message ID are required' });
    }

    try {
        const group = await Group.findOneAndUpdate(
            { telegramChatId: chatId },
            { lastScheduleMessageId: messageId },
            { new: true }
        );

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Update group last schedule message error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/subscribers', protectBotRoute, async (req, res) => {
    try {
        const subscribers = await User.find({
            ...activeUserFilter,
            isBlocked: { $ne: true },
            telegramChatId: { $ne: null }
        }).select('telegramChatId role -_id');
        res.json(subscribers);
    } catch (error) {
        console.error('Get subscribers error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// --- НОВЫЙ ЭНДПОИНТ: Получение профиля ---
router.get('/me/:chatId', protectBotRoute, async (req, res) => {
    try {
        const { chatId } = req.params;
        // Возвращаем только нужные поля, пароль и токен не нужны
        const user = await User.findOne({ telegramChatId: chatId }).select('fullName group hemisLogin role language -_id');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ success: true, data: user });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// --- ЭНДПОИНТ: Получение языка пользователя ---
router.get('/language/:chatId', protectBotRoute, async (req, res) => {
    try {
        const { chatId } = req.params;
        const user = await User.findOne({ telegramChatId: chatId }).select('language -_id');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ success: true, language: user.language || null });
    } catch (error) {
        console.error('Get language error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// --- ЭНДПОИНТ: Установка языка пользователя ---
router.post('/set-language', protectBotRoute, async (req, res) => {
    try {
        const { chatId, language } = req.body;

        if (!chatId || !language) {
            return res.status(400).json({ message: 'ChatId and Language are required' });
        }

        if (!['ru-RU', 'uz-UZ'].includes(language)) {
            return res.status(400).json({ message: 'Invalid language. Must be ru-RU or uz-UZ' });
        }

        let user = await User.findOne({ telegramChatId: chatId });

        if (!user) {
            // Создаем пользователя с минимальными данными, если его нет
            // Это нужно для сохранения языка до регистрации
            user = new User({
                hemisLogin: `temp_${chatId}`, // Временный логин, будет заменен при регистрации
                hemisPassword: 'temp', // Временный пароль, будет заменен при регистрации
                telegramChatId: chatId,
                language: language
            });
        } else {
            user.language = language;
        }

        await user.save();

        res.json({ success: true, message: 'Language updated successfully' });
    } catch (error) {
        if (error.code === 11000) {
            // Если конфликт по hemisLogin, обновляем существующего пользователя
            const user = await User.findOne({ telegramChatId: chatId });
            if (user) {
                user.language = language;
                await user.save();
                return res.json({ success: true, message: 'Language updated successfully' });
            }
        }
        console.error('Set language error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getExactGroupMatcher(groupName) {
    return new RegExp(`^${escapeRegExp(String(groupName).trim())}$`, 'i');
}

function sortGroupCandidates(left, right) {
    const leftRateLimited = isUserRateLimited(left);
    const rightRateLimited = isUserRateLimited(right);
    if (leftRateLimited !== rightRateLimited) {
        return leftRateLimited ? 1 : -1;
    }

    const leftHasToken = Boolean(left.hemisToken);
    const rightHasToken = Boolean(right.hemisToken);
    if (leftHasToken !== rightHasToken) {
        return leftHasToken ? -1 : 1;
    }

    return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
}

async function getGroupScheduleForUser(user) {
    const plainPassword = decrypt(user.hemisPassword);
    let hemisToken = user.hemisToken;
    const userLanguage = user.language || 'ru-RU';

    if (isUserRateLimited(user)) {
        throw { status: 429, message: DEFAULT_RATE_LIMIT_MESSAGE };
    }

    if (!hemisToken) {
        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
        const loginResult = await applyLoginResult(user, authData);
        if (!loginResult.token) {
            throw loginResult.rateLimited
                ? { status: 429, message: DEFAULT_RATE_LIMIT_MESSAGE }
                : { status: 401, message: 'Failed to authenticate with HEMIS for this group member' };
        }

        hemisToken = loginResult.token;
    }

    const semesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
    if (!semesterCode) {
        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
        const loginResult = await applyLoginResult(user, authData);
        if (!loginResult.token) {
            throw loginResult.rateLimited
                ? { status: 429, message: DEFAULT_RATE_LIMIT_MESSAGE }
                : { status: 401, message: 'Failed to re-authenticate with HEMIS' };
        }

        hemisToken = loginResult.token;
        const newSemesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
        if (!newSemesterCode) {
            throw { status: 400, message: 'Could not determine semester.' };
        }

        const scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, newSemesterCode, userLanguage);
        return { schedule: scheduleResult, role: 'student' };
    }

    let scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, semesterCode, userLanguage);

    if (scheduleResult?.error === 'unauthorized') {
        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
        const loginResult = await applyLoginResult(user, authData);
        if (!loginResult.token) {
            throw loginResult.rateLimited
                ? { status: 429, message: DEFAULT_RATE_LIMIT_MESSAGE }
                : { status: 401, message: 'Failed to re-authenticate with HEMIS' };
        }

        hemisToken = loginResult.token;
        scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, semesterCode, userLanguage);
    }

    if (scheduleResult === null || scheduleResult?.error) {
        throw { status: 500, message: 'Failed to fetch schedule from HEMIS' };
    }

    return { schedule: scheduleResult, role: 'student' };
}

async function getGroupSchedule(groupName) {
    const candidates = await User.find({
        ...activeUserFilter,
        group: getExactGroupMatcher(groupName)
    });

    if (!candidates.length) {
        throw { status: 404, message: `No registered student found for group ${groupName}.` };
    }

    let lastError = null;
    let sawRateLimitedCandidate = false;

    for (const candidate of candidates.sort(sortGroupCandidates)) {
        try {
            return await getGroupScheduleForUser(candidate);
        } catch (error) {
            if (error?.status === 429) {
                sawRateLimitedCandidate = true;
            }
            lastError = error;
        }
    }

    if (lastError && lastError.status !== 429) {
        throw lastError;
    }

    if (sawRateLimitedCandidate) {
        throw { status: 429, message: DEFAULT_RATE_LIMIT_MESSAGE };
    }

    throw lastError || { status: 500, message: 'Failed to fetch group schedule from HEMIS' };
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

router.get('/schedule/group-by-chat-id/:chatId', protectBotRoute, async (req, res) => {
    try {
        const { chatId } = req.params;
        const group = await Group.findOne({ telegramChatId: chatId });
        if (!group) {
            return res.status(404).json({ message: 'Этот чат не привязан к академической группе.' });
        }
        const result = await getGroupSchedule(group.groupName);
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
        const scheduleResponse = await resolveUserSchedule(user, plainPassword, scheduleService);
        return res.status(scheduleResponse.status).json(scheduleResponse.body);
        const userLanguage = user.language || 'ru-RU'; // Используем язык пользователя или по умолчанию русский

        let hemisToken = user.hemisToken;
        if (!hemisToken) {
            const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
            if (!authData) return res.status(401).json({ message: 'Failed to authenticate with HEMIS' });
            hemisToken = authData.token;
            user.hemisToken = hemisToken;
            await user.save();
        }

        const semesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
        if (!semesterCode) {
            console.log("Could not get semester, trying to re-login to HEMIS...");
            const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
            if (!authData) return res.status(401).json({ message: 'Failed to re-authenticate with HEMIS' });
            hemisToken = authData.token;
            user.hemisToken = hemisToken;
            await user.save();
            const newSemesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
            if (!newSemesterCode) return res.status(400).json({ message: 'Could not determine semester even after re-login.' });

            const scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, newSemesterCode, userLanguage);
            return res.json({ schedule: scheduleResult, role: user.role });
        }

        let scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, semesterCode, userLanguage);

        if (scheduleResult?.error === 'unauthorized') {
            const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
            if (!authData) return res.status(401).json({ message: 'Failed to re-authenticate with HEMIS' });
            hemisToken = authData.token;
            user.hemisToken = hemisToken;
            await user.save();
            scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, semesterCode, userLanguage);
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


router.get('/attendance/:chatId', protectBotRoute, async (req, res) => {
    try {
        const { chatId } = req.params;
        const user = await User.findOne({ telegramChatId: chatId });

        if (!user) return res.status(404).json({ message: 'User not found' });
        if (user.role !== 'student') return res.status(400).json({ message: 'Only students have attendance records' });

        const plainPassword = decrypt(user.hemisPassword);
        const attendanceResponse = await resolveUserAttendance(user, plainPassword, scheduleService);
        return res.status(attendanceResponse.status).json(attendanceResponse.body);
        const userLanguage = user.language || 'ru-RU'; // Используем язык пользователя или по умолчанию русский
        let hemisToken = user.hemisToken;

        // 1. Проверка/Обновление токена (стандартная процедура)
        if (!hemisToken) {
            const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
            if (!authData) return res.status(401).json({ message: 'Failed to authenticate' });
            hemisToken = authData.token;
            user.hemisToken = hemisToken;
            await user.save();
        }

        // 2. Получение семестра
        let semesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
        if (!semesterCode) {
            // Ре-логин если токен протух
            const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
            if (!authData) return res.status(401).json({ message: 'Failed to re-authenticate' });
            hemisToken = authData.token;
            user.hemisToken = hemisToken;
            await user.save();
            semesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
        }

        if (!semesterCode) return res.status(400).json({ message: 'Semester not found' });

        // 3. Запрос посещаемости
        let attendanceData = await scheduleService.getAttendanceFromHemis(hemisToken, semesterCode, userLanguage);

        // Обработка 401 при запросе данных
        if (attendanceData?.error === 'unauthorized') {
            const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
            if (!authData) return res.status(401).json({ message: 'Failed to re-authenticate' });
            hemisToken = authData.token;
            user.hemisToken = hemisToken;
            await user.save();
            attendanceData = await scheduleService.getAttendanceFromHemis(hemisToken, semesterCode, userLanguage);
        }

        if (!attendanceData) {
            return res.status(500).json({ message: 'Failed to fetch attendance' });
        }

        res.json({ success: true, data: attendanceData });

    } catch (error) {
        console.error('Get attendance error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});


// --- ЭНДПОИНТ: Полный выход (Logout) ---
router.post('/logout', protectBotRoute, async (req, res) => {
    try {
        const { chatId } = req.body;
        if (!chatId) return res.status(400).json({ message: 'ChatId required' });

        // Полностью удаляем пользователя из базы
        await User.findOneAndDelete({ telegramChatId: chatId });

        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// --- ЭНДПОИНТ: Обновление активности ("Я жив") ---
router.post('/activity', protectBotRoute, async (req, res) => {
    const { chatId, isBlocked } = req.body;
    if (!chatId) return res.sendStatus(400);

    try {
        const updateData = { lastActiveAt: new Date() };
        if (typeof isBlocked === 'boolean') {
            updateData.isBlocked = isBlocked;
        } else {
            updateData.isBlocked = false;
        }

        await User.updateOne({ telegramChatId: chatId }, updateData);
        res.sendStatus(200);
    } catch (e) {
        // Ошибки тут не критичны, логировать не обязательно
        res.sendStatus(500);
    }
});

router.post('/delivery-failed', protectBotRoute, async (req, res) => {
    const { chatId, chatType } = req.body;

    if (!chatId) {
        return res.sendStatus(400);
    }

    try {
        if (chatType === 'group') {
            await Group.findOneAndDelete({ telegramChatId: chatId });
            return res.sendStatus(200);
        }

        await User.updateOne({ telegramChatId: chatId }, { isBlocked: true });
        res.sendStatus(200);
    } catch (error) {
        res.sendStatus(500);
    }
});
// --- ЭНДПОИНТ: Расширенная статистика для админа ---
router.get('/stats', protectBotRoute, async (req, res) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);

        const monthAgo = new Date();
        monthAgo.setDate(monthAgo.getDate() - 30);

        // Базовый фильтр: исключаем временных пользователей (temp_*)
        const baseUserFilter = { hemisLogin: { $not: /^temp_/i } };

        // 1. АУДИТОРИЯ
        const totalUsers = await User.countDocuments(baseUserFilter);
        const blockedUsers = await User.countDocuments({ ...baseUserFilter, isBlocked: true });
        const activeUsers = await User.countDocuments({ ...baseUserFilter, isBlocked: { $ne: true } });

        // 2. ДИНАМИКА ПРИРОСТА (Новые регистрации)
        const newToday = await User.countDocuments({ ...baseUserFilter, createdAt: { $gte: todayStart } });
        const newWeek = await User.countDocuments({ ...baseUserFilter, createdAt: { $gte: weekAgo } });

        // 3. АКТИВНОСТЬ (DAU / WAU)
        // Пользователи, которые нажимали что-то сегодня
        const dau = await User.countDocuments({ ...baseUserFilter, isBlocked: { $ne: true }, lastActiveAt: { $gte: todayStart } });
        // Пользователи, активные за неделю
        const wau = await User.countDocuments({ ...baseUserFilter, isBlocked: { $ne: true }, lastActiveAt: { $gte: weekAgo } });
        // Спящие (не заходили месяц)
        const sleeping = await User.countDocuments({ ...baseUserFilter, lastActiveAt: { $lt: monthAgo } });

        // 4. СИСТЕМА
        const uniqueGroups = await User.distinct('group', { ...baseUserFilter, role: 'student' });
        const connectedChats = await Group.countDocuments({});

        res.json({
            success: true,
            audience: {
                total: totalUsers,
                active: activeUsers,
                blocked: blockedUsers
            },
            growth: {
                today: newToday,
                week: newWeek
            },
            activity: {
                dau: dau,
                wau: wau,
                sleeping: sleeping
            },
            system: {
                groups: uniqueGroups.filter(Boolean).length,
                chats: connectedChats
            }
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// --- ЭНДПОИНТ: Авто-привязка группы через студента ---
router.post('/bind-by-user', protectBotRoute, async (req, res) => {
    const { groupChatId, userTelegramId } = req.body;

    if (!groupChatId || !userTelegramId) {
        return res.status(400).json({ message: 'Missing parameters' });
    }

    try {
        // 1. Ищем студента, который нажал кнопку
        const student = await User.findOne({ telegramChatId: userTelegramId });

        if (!student) {
            return res.status(404).json({ message: 'user_not_found' });
        }

        if (!student.group) {
            return res.status(400).json({ message: 'У вас не указана группа в профиле.' });
        }

        const groupName = student.group;

        // 2. Привязываем группу (копируем логику из bind-group)
        let group = await Group.findOne({ telegramChatId: groupChatId });
        if (group) {
            group.groupName = groupName;
        } else {
            // Проверяем, не занята ли группа другим чатом
            const existing = await Group.findOne({ groupName });
            if (existing) {
                return res.status(409).json({ message: `Группа "${groupName}" уже привязана к другому чату.` });
            }
            group = new Group({ groupName, telegramChatId: groupChatId });
        }

        await group.save();

        res.json({ success: true, groupName: groupName, studentName: student.fullName });

    } catch (error) {
        console.error('Bind by user error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
