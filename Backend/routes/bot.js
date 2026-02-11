// Backend/routes/bot.js

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Group = require('../models/Group');
const scheduleRouter = require('./schedule');
const scheduleService = scheduleRouter.scheduleService;
const { encrypt, decrypt } = require('../utils/crypto');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
        const encryptedPassword = encrypt(hemisPassword);

        // --- НОВАЯ ЛОГИКА: Сразу получаем текущие прогулы, чтобы запомнить их ---
        let initialAbsentHours = 0;
        let user = await User.findOne({ telegramChatId: chatId });
        const userLanguage = user?.language || 'ru-RU'; // Используем сохраненный язык или по умолчанию русский

        if (profileData.isStudent) {
            const semesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
            if (semesterCode) {
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
            user.fullName = profileData.fullName;
            user.role = profileData.isStudent ? 'student' : 'teacher';
            user.group = profileData.groupName;
            user.lastKnownAbsentHours = initialAbsentHours;

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
                fullName: profileData.fullName,
                role: profileData.isStudent ? 'student' : 'teacher',
                group: profileData.groupName,
                lastKnownAbsentHours: initialAbsentHours
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
    // Вспомогательная функция сравнения (вынести сюда, перед циклом)
    async function processAttendanceDiff(user, currentData, notifications) {
        const currentTotal = currentData.totalHours || 0; // Добавляем проверку на undefined
        const lastKnown = user.lastKnownAbsentHours;

        // Если это первый запуск для юзера (значение -1 или undefined), просто сохраняем
        if (lastKnown === -1 || lastKnown === undefined || lastKnown === null) {
            user.lastKnownAbsentHours = currentTotal;
            await user.save();
            return;
        }

        // ЕСЛИ НАШЛИ РАЗНИЦУ В БОЛЬШУЮ СТОРОНУ
        if (currentTotal > lastKnown) {
            const diff = currentTotal - lastKnown;

            // Находим предмет, по которому прилетел NB (последний по дате)
            // Сортируем все детали всех предметов по дате убывания
            let allDetails = [];
            if (currentData.subjects && currentData.subjects.length > 0) {
                currentData.subjects.forEach(sub => {
                    if (sub.details && sub.details.length > 0) {
                        sub.details.forEach(det => {
                            allDetails.push({ ...det, subjectName: sub.name });
                        });
                    }
                });
            }
            allDetails.sort((a, b) => b.date - a.date); // Самые свежие сверху

            const latestNB = allDetails[0]; // Самый последний NB

            notifications.push({
                chatId: user.telegramChatId,
                diff: diff,
                total: currentTotal,
                latestSubject: latestNB ? latestNB.subjectName : null,
                latestDate: latestNB ? latestNB.date : null
            });

            // Обновляем базу
            user.lastKnownAbsentHours = currentTotal;
            await user.save();
        }
        // Если часов стало меньше (например, убрали NB), просто обновляем базу без уведомления
        else if (currentTotal < lastKnown) {
            user.lastKnownAbsentHours = currentTotal;
            await user.save();
        }
        // Если не изменилось, тоже обновляем базу (на случай если структура данных изменилась)
        else if (currentTotal === lastKnown) {
            // Можно обновить базу, но не обязательно
            // user.lastKnownAbsentHours = currentTotal;
            // await user.save();
        }
    }

    try {
        // Ищем всех студентов, у которых есть chatID
        const students = await User.find({ role: 'student', telegramChatId: { $ne: null } });

        const notifications = [];

        for (const user of students) {
            try {
                // Расшифровка пароля
                const plainPassword = decrypt(user.hemisPassword);
                let hemisToken = user.hemisToken;
                const userLanguage = user.language || 'ru-RU'; // Используем язык пользователя или по умолчанию русский

                // 1. Получаем семестр (с авто-обновлением токена)
                let semesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);

                if (!semesterCode) {
                    // Ре-логин
                    const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
                    if (authData) {
                        hemisToken = authData.token;
                        user.hemisToken = hemisToken;
                        await user.save();
                        semesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
                    }
                }

                if (!semesterCode) continue; // Пропускаем, если не удалось войти

                // 2. Получаем посещаемость
                const attData = await scheduleService.getAttendanceFromHemis(hemisToken, semesterCode, userLanguage);

                // Если ошибка авторизации при получении данных
                if (attData?.error === 'unauthorized') {
                    const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
                    if (authData) {
                        hemisToken = authData.token;
                        user.hemisToken = hemisToken;
                        await user.save();
                        // Повторный запрос
                        const retryData = await scheduleService.getAttendanceFromHemis(hemisToken, semesterCode, userLanguage);
                        if (retryData && !retryData.error) {
                            await processAttendanceDiff(user, retryData, notifications);
                        } else if (retryData === null) {
                            console.log(`Failed to get attendance for user ${user.hemisLogin} after re-login`);
                        }
                    }
                } else if (attData && !attData.error) {
                    await processAttendanceDiff(user, attData, notifications);
                } else if (attData === null) {
                    // Если данные не получены (не ошибка авторизации, но и не данные)
                    console.log(`Failed to get attendance for user ${user.hemisLogin}: API returned null`);
                    // НЕ обновляем lastKnownAbsentHours, чтобы не потерять текущее состояние
                }

            } catch (err) {
                console.error(`Error checking user ${user.hemisLogin}:`, err.message);
                // бэкофф, чтобы не долбить HEMIS при ошибках/лимитах
                await sleep(2000);
            }

            await sleep(1500); // Пауза 1.5 сек после каждого студента для равномерной нагрузки
        }

        res.json({ success: true, notifications });

    } catch (error) {
        console.error('Global attendance check error:', error);
        res.status(500).json({ message: 'Server error' });
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

async function getGroupSchedule(groupName) {
    const user = await User.findOne({
        group: { $regex: groupName, $options: 'i' }
    });

    if (!user) {
        throw { status: 404, message: `Не найден зарегистрированный студент для группы ${groupName}.` };
    }

    const plainPassword = decrypt(user.hemisPassword);
    let hemisToken = user.hemisToken;
    const userLanguage = user.language || 'ru-RU'; // Используем язык пользователя или по умолчанию русский

    if (!hemisToken) {
        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
        if (!authData) throw { status: 401, message: 'Ошибка аутентификации HEMIS от имени участника группы' };
        hemisToken = authData.token;
        user.hemisToken = hemisToken;
        await user.save();
    }

    const semesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
    if (!semesterCode) {
        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
        if (!authData) throw { status: 401, message: 'Ошибка повторной аутентификации в HEMIS' };
        hemisToken = authData.token;
        user.hemisToken = hemisToken;
        await user.save();
        const newSemesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
        if (!newSemesterCode) throw { status: 400, message: 'Не удалось определить семестр.' };

        const scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, newSemesterCode, userLanguage);
        return { schedule: scheduleResult, role: 'student' };
    }

    let scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, semesterCode, userLanguage);

    if (scheduleResult?.error === 'unauthorized') {
        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
        if (!authData) throw { status: 401, message: 'Ошибка повторной аутентификации в HEMIS' };
        hemisToken = authData.token;
        user.hemisToken = hemisToken;
        await user.save();
        scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, semesterCode, userLanguage);
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
        }

        await User.updateOne({ telegramChatId: chatId }, updateData);
        res.sendStatus(200);
    } catch (e) {
        // Ошибки тут не критичны, логировать не обязательно
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
