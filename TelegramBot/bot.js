// TelegramBot/bot.js

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');
const keyboards = require('./keyboards');
const i18n = require('./i18n');

function startBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const apiUrl = process.env.MINI_HEMIS_API_URL;
    const botApiSecret = process.env.BOT_API_SECRET;

    if (!token || !apiUrl || !botApiSecret) {
        console.error('Ошибка: одна или несколько переменных окружения не найдены!');
        process.exit(1);
    }

    const bot = new TelegramBot(token, { polling: true });
    console.log('Телеграм-бот запущен...');

    // Регистрация команд (будут локализованы при первом использовании)
    bot.setMyCommands([
        { command: '/start', description: '🏠 Главное меню' },
        { command: '/schedule_today', description: '📅 Расписание на сегодня' },
        { command: '/schedule_tomorrow', description: '📅 Расписание на завтра' },
        { command: '/me', description: '👤 Мой профиль' },
        { command: '/login', description: '🔑 Вход в систему' }
    ]);

    const userStates = {};

    // --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

    // Получение языка пользователя
    async function getUserLanguage(chatId) {
        try {
            const { data } = await axios.get(`${apiUrl}/api/bot/language/${chatId}`, {
                headers: { 'x-bot-secret': botApiSecret }
            });
            return data.language || 'ru-RU';
        } catch (error) {
            return 'ru-RU'; // Fallback to Russian
        }
    }

    // Установка языка пользователя
    async function setUserLanguage(chatId, language) {
        try {
            await axios.post(`${apiUrl}/api/bot/set-language`, {
                chatId: chatId.toString(),
                language
            }, {
                headers: { 'x-bot-secret': botApiSecret }
            });
            return true;
        } catch (error) {
            console.error('Error setting language:', error);
            return false;
        }
    }

    function formatSchedule(schedule, role, dateObject, groupName, language = 'ru-RU') {
        // Форматирование даты с учетом языка
        const locale = language === 'uz-UZ' ? 'uz-UZ' : 'ru-RU';
        const dateStr = dateObject.toLocaleDateString(locale, { day: 'numeric', month: 'long' });

        // Заголовок
        let message = `<b>${i18n.t(language, 'scheduleFor')} ${dateStr}:</b>\n`;

        if (groupName) {
            message += `👥 <b>${i18n.t(language, 'group')}:</b> ${groupName}\n`;
        }
        message += `\n`;

        // Если пар нет
        if (!schedule || schedule.length === 0) {
            message += i18n.t(language, 'noLessons');
            message += `\n👉 @HEMISnotify_bot`;
            return message;
        }

        // Сортировка по времени
        schedule.sort((a, b) => a.time.localeCompare(b.time));

        // Старый стиль списка
        schedule.forEach(item => {
            message += `🕒 <b>${item.time}</b>\n`;
            message += `📚 ${item.subjectId.name}\n`;
            if (item.subjectId.lessonType) message += `🏷️ ${item.subjectId.lessonType}\n`;

            if (role === 'teacher') {
                message += `👥 ${item.subjectId.groupName}\n`;
            } else {
                message += `👤 ${item.subjectId.teacherName}\n`;
            }

            message += `🚪 ${item.subjectId.auditoriumName}\n`;
            message += `--------------------\n`;
        });

        message += `\n👉 @HEMISnotify_bot`;
        return message;
    }

    async function handleScheduleRequest(chatId, dateObject, messageIdToEdit = null, isGroup = false) {
        // Для групп используем русский по умолчанию, так как пользователя может не быть в базе
        const language = isGroup ? 'ru-RU' : await getUserLanguage(chatId);
        let loadingMsg;

        if (!messageIdToEdit) {
            loadingMsg = await bot.sendMessage(chatId, i18n.t(language, 'loading'));
        }

        try {
            let scheduleData;
            let groupName = '';

            if (isGroup) {
                // Для групп используем специальный эндпоинт
                const { data } = await axios.get(`${apiUrl}/api/bot/schedule/group-by-chat-id/${chatId}`, {
                    headers: { 'x-bot-secret': botApiSecret }
                });
                scheduleData = data;
                groupName = data.groupName || '';
            } else {
                // Для личных чатов используем обычный эндпоинт
                const { data } = await axios.get(`${apiUrl}/api/bot/schedule/${chatId}`, {
                    headers: { 'x-bot-secret': botApiSecret }
                });
                scheduleData = data;

                // Получаем профиль для имени группы
                try {
                    const { data: profileData } = await axios.get(`${apiUrl}/api/bot/me/${chatId}`, {
                        headers: { 'x-bot-secret': botApiSecret }
                    });
                    groupName = profileData?.data?.group || '';
                } catch (e) {
                    // Игнорируем ошибку получения профиля
                }
            }

            const daySchedule = scheduleData.schedule.filter(item => {
                const lessonDate = new Date(item.lesson_date * 1000);
                return lessonDate.getFullYear() === dateObject.getFullYear() &&
                    lessonDate.getMonth() === dateObject.getMonth() &&
                    lessonDate.getDate() === dateObject.getDate();
            });

            const formattedText = formatSchedule(
                daySchedule,
                scheduleData.role || 'student',
                dateObject,
                groupName,
                language
            );

            const replyMarkup = keyboards.getSchedulePagination(dateObject, language);

            if (messageIdToEdit) {
                try {
                    await bot.editMessageText(formattedText, {
                        chat_id: chatId,
                        message_id: messageIdToEdit,
                        parse_mode: 'HTML',
                        reply_markup: replyMarkup.reply_markup
                    });
                } catch (editError) {
                    if (!editError.message.includes('message is not modified')) {
                        console.error('Edit message error:', editError.message);
                    }
                }
            } else {
                if (loadingMsg) await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => { });
                await bot.sendMessage(chatId, formattedText, {
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup.reply_markup
                });
            }

        } catch (error) {
            console.error(error);
            const errorText = i18n.t(language, 'scheduleError');
            if (loadingMsg) await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => { });

            if (!messageIdToEdit) {
                bot.sendMessage(chatId, errorText);
            }
        }
    }

    // --- ОБРАБОТЧИКИ КНОПОК ---

    // 1. Кнопка "📚 Уроки" / "📚 Darslar"
    bot.onText(/(📚 Уроки|📚 Darslar)/, (msg) => {
        const today = new Date();
        const isGroup = ['group', 'supergroup'].includes(msg.chat.type);
        handleScheduleRequest(msg.chat.id, today, null, isGroup);
    });

    // 2. Кнопка "🚫 Прогулы" / "🚫 Qoldirishlar"
    bot.onText(/(🚫 Прогулы|🚫 Qoldirishlar)/, async (msg) => {
        const chatId = msg.chat.id;
        const language = await getUserLanguage(chatId);
        const loading = await bot.sendMessage(chatId, i18n.t(language, 'loadingAttendance'));

        try {
            const response = await axios.get(`${apiUrl}/api/bot/attendance/${chatId}`, {
                headers: { 'x-bot-secret': botApiSecret }
            });

            const { totalHours, justifiedHours, unjustifiedHours, subjects } = response.data.data;

            await bot.deleteMessage(chatId, loading.message_id).catch(() => { });

            const locale = language === 'uz-UZ' ? 'uz-UZ' : 'ru-RU';
            let text = `📊 <b>${i18n.t(language, 'myAttendance')}</b>\n`;
            text += `══════════════════\n`;
            text += `🔴 <b>${i18n.t(language, 'totalAbsent')}:</b> ${totalHours} ${i18n.t(language, 'hours')}\n`;
            text += `❌ ${i18n.t(language, 'withoutReason')}: <b>${unjustifiedHours} ${i18n.t(language, 'hours')}</b>\n`;
            text += `🟢 ${i18n.t(language, 'withReason')}: <b>${justifiedHours} ${i18n.t(language, 'hours')}</b>\n\n`;

            if (subjects.length > 0) {
                subjects.forEach(sub => {
                    text += `📚 <b>${sub.name}</b> (${sub.totalSubjectHours} ${i18n.t(language, 'hours')})\n`;

                    sub.details.forEach(det => {
                        const dateObj = new Date(det.date * 1000);
                        const dateStr = dateObj.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
                        const statusIcon = det.isJustified ? "🟢" : "❌";
                        const typeText = det.isJustified ? i18n.t(language, 'justified') : i18n.t(language, 'unjustified');

                        text += `   ▪️ ${dateStr} ${det.time} — ${det.hours}${i18n.t(language, 'hours')} (${statusIcon})\n`;
                    });
                    text += `\n`;
                });

            } else {
                text += `✅ <b>${i18n.t(language, 'congratulations')}</b> ${i18n.t(language, 'noAbsences')}`;
            }

            text += `\n👉 @HEMISnotify_bot`;
            bot.sendMessage(chatId, text, { parse_mode: 'HTML' });

        } catch (error) {
            await bot.deleteMessage(chatId, loading.message_id).catch(() => { });
            if (error.response?.status === 400) {
                bot.sendMessage(chatId, i18n.t(language, 'attendanceOnlyStudents'));
            } else {
                bot.sendMessage(chatId, i18n.t(language, 'attendanceError'));
            }
        }
    });

    // 3. Обработка нажатий на инлайн-кнопки (Назад / Вперед, Выбор языка)
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const data = query.data;
        const messageId = query.message.message_id;

        if (data.startsWith('sched_')) {
            const dateStr = data.split('_')[1];
            const targetDate = new Date(dateStr);
            const isGroup = ['group', 'supergroup'].includes(query.message.chat.type);

            await bot.answerCallbackQuery(query.id);
            await handleScheduleRequest(chatId, targetDate, messageId, isGroup);
        } else if (data.startsWith('lang_')) {
            const language = data.split('_')[1]; // 'ru-RU' or 'uz-UZ'
            await bot.answerCallbackQuery(query.id);

            const success = await setUserLanguage(chatId, language);
            if (success) {
                const langName = i18n.getLanguageName(language);
                await bot.sendMessage(chatId, `✅ ${i18n.t(language, 'languageChanged')}`);

                // Проверяем, зарегистрирован ли пользователь
                try {
                    await axios.get(`${apiUrl}/api/bot/schedule/${chatId}`, { headers: { 'x-bot-secret': botApiSecret } });
                    await bot.sendMessage(chatId, i18n.t(language, 'welcomeBack'), keyboards.getMainMenu(language));
                } catch (error) {
                    // ЕСЛИ НЕ ЗАРЕГИСТРИРОВАН -> БЕСШОВНЫЙ ОНБОРДИНГ
                    await bot.sendMessage(chatId, i18n.t(language, 'welcomeOnboarding'), { parse_mode: 'HTML' });

                    // Сразу переводим в режим ожидания логина
                    userStates[chatId] = { state: 'awaiting_hemis_login' };
                    await bot.sendMessage(chatId, i18n.t(language, 'enterHemisLogin'), {
                        parse_mode: 'HTML',
                        ...keyboards.removeKeyboard
                    });
                }
            }
        }
    });

    // 4. Кнопка "Мой профиль" / "Mening profilim"
    bot.onText(/(👤 Мой профиль|👤 Mening profilim)/, async (msg) => {
        const language = await getUserLanguage(msg.chat.id);
        try {
            const { data: { data: user } } = await axios.get(`${apiUrl}/api/bot/me/${msg.chat.id}`, { headers: { 'x-bot-secret': botApiSecret } });
            let txt = `<b>👤 ${i18n.t(language, 'yourProfile')}:</b>\n\n` +
                `📛 <b>${i18n.t(language, 'fullName')}:</b> ${user.fullName}\n` +
                `🆔 <b>${i18n.t(language, 'login')}:</b> ${user.hemisLogin}\n` +
                `🏫 <b>${i18n.t(language, 'groupLabel')}:</b> ${user.group || i18n.t(language, 'notSpecified')}\n` +
                `🎓 <b>${i18n.t(language, 'role')}:</b> ${user.role === 'student' ? i18n.t(language, 'student') : i18n.t(language, 'teacher')}`;
            txt += `\n\n👉 @HEMISnotify_bot`;
            bot.sendMessage(msg.chat.id, txt, { parse_mode: 'HTML' });
        } catch (e) {
            bot.sendMessage(msg.chat.id, i18n.t(language, 'profileNotFound'), keyboards.getGuestMenu(language));
        }
    });

    // 5. Кнопка "🌐 Сменить язык" / "🌐 Tilni o'zgartirish"
    bot.onText(/(🌐 Сменить язык|🌐 Tilni o'zgartirish)/, async (msg) => {
        const chatId = msg.chat.id;
        await bot.sendMessage(chatId, i18n.t(await getUserLanguage(chatId), 'selectLanguage'), keyboards.getLanguageSelectionKeyboard());
    });



    const loginHandler = async (msg) => {
        const language = await getUserLanguage(msg.chat.id);
        if (msg.chat.type !== 'private') return bot.sendMessage(msg.chat.id, i18n.t(language, 'loginOnlyPrivate'));
        userStates[msg.chat.id] = { state: 'awaiting_hemis_login' };
        bot.sendMessage(msg.chat.id, i18n.t(language, 'enterHemisLogin'), { parse_mode: 'HTML', ...keyboards.removeKeyboard });
    };

    bot.onText(/(🔄 Сменить аккаунт|🔄 Hisobni o'zgartirish)/, loginHandler);
    bot.onText(/(🔑 Вход в систему|🔑 Tizimga kirish)/, loginHandler);
    bot.onText(/\/login/, loginHandler);

    // Обработчик команды /help
    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        const language = await getUserLanguage(chatId);

        const helpText = language === 'uz-UZ'
            ? `ℹ️ Yordam\n\n` +
            `Bu bot HEMIS tizimidan dars jadvalingizni avtomatik yuboradi.\n\n` +
            `⏰ Avtomatik yuborish:\n\n` +
            `🕖 7:00 — bugungi jadval\n\n` +
            `🌙 19:00 — ertangi jadval\n\n` +
            `📚 Guruh chatlari uchun:\n\n` +
            `Administrator chatni akademik guruhga bog'lashi mumkin\n` +
            `buyruq bilan:\n\n` +
            `/bind_group GURUH_NOMI\n\n` +
            `Misol:\n\n` +
            `/bind_group 915-23 KII\n\n` +
            `Bog'langanidan keyin jadval avtomatik ravishda guruhga keladi.`
            : `ℹ️ Помощь\n\n` +
            `Этот бот автоматически отправляет ваше расписание из системы HEMIS.\n\n` +
            `⏰ Автоматическая рассылка:\n\n` +
            `🕖 7:00 — расписание на сегодня\n\n` +
            `🌙 19:00 — расписание на завтра\n\n` +
            `📚 Для групповых чатов:\n\n` +
            `Администратор может привязать чат к академической группе\n` +
            `командой:\n\n` +
            `/bind_group НАЗВАНИЕ_ГРУППЫ\n\n` +
            `Пример:\n\n` +
            `/bind_group 915-23 KII\n\n` +
            `После привязки расписание будет автоматически приходить в группу.`;

        bot.sendMessage(chatId, helpText);
    });

    // Обработчик команды /schedule_today
    bot.onText(/\/schedule_today/, async (msg) => {
        const today = new Date();
        const isGroup = ['group', 'supergroup'].includes(msg.chat.type);
        await handleScheduleRequest(msg.chat.id, today, null, isGroup);
    });

    // Обработчик команды /schedule_tomorrow
    bot.onText(/\/schedule_tomorrow/, async (msg) => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const isGroup = ['group', 'supergroup'].includes(msg.chat.type);
        await handleScheduleRequest(msg.chat.id, tomorrow, null, isGroup);
    });

    // Обработчик команды /me
    bot.onText(/\/me/, async (msg) => {
        const language = await getUserLanguage(msg.chat.id);
        try {
            const { data: { data: user } } = await axios.get(`${apiUrl}/api/bot/me/${msg.chat.id}`, { headers: { 'x-bot-secret': botApiSecret } });
            let txt = `<b>👤 ${i18n.t(language, 'yourProfile')}:</b>\n\n` +
                `📛 <b>${i18n.t(language, 'fullName')}:</b> ${user.fullName}\n` +
                `🆔 <b>${i18n.t(language, 'login')}:</b> ${user.hemisLogin}\n` +
                `🏫 <b>${i18n.t(language, 'groupLabel')}:</b> ${user.group || i18n.t(language, 'notSpecified')}\n` +
                `🎓 <b>${i18n.t(language, 'role')}:</b> ${user.role === 'student' ? i18n.t(language, 'student') : i18n.t(language, 'teacher')}`;
            txt += `\n\n👉 @HEMISnotify_bot`;
            bot.sendMessage(msg.chat.id, txt, { parse_mode: 'HTML' });
        } catch (e) {
            bot.sendMessage(msg.chat.id, i18n.t(language, 'profileNotFound'), keyboards.getGuestMenu(language));
        }
    });

    // --- КОМАНДА /START ---
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        if (msg.chat.type !== 'private') {
            const language = await getUserLanguage(chatId);
            return bot.sendMessage(chatId, i18n.t(language, 'helloGroup'));
        }

        delete userStates[chatId];

        // Проверяем, выбран ли язык
        try {
            const { data } = await axios.get(`${apiUrl}/api/bot/language/${chatId}`, {
                headers: { 'x-bot-secret': botApiSecret }
            });

            if (!data.language) {
                // Язык не выбран - показываем выбор языка
                return bot.sendMessage(chatId, i18n.t('ru-RU', 'selectLanguage'), keyboards.getLanguageSelectionKeyboard());
            }

            const language = data.language;

            // Проверяем, зарегистрирован ли пользователь
            try {
                await axios.get(`${apiUrl}/api/bot/schedule/${chatId}`, { headers: { 'x-bot-secret': botApiSecret } });
                bot.sendMessage(chatId, i18n.t(language, 'welcomeBack'), keyboards.getMainMenu(language));
            } catch (error) {
                // ЕСЛИ НЕ ЗАРЕГИСТРИРОВАН -> БЕСШОВНЫЙ ОНБОРДИНГ
                await bot.sendMessage(chatId, i18n.t(language, 'welcomeOnboarding'), { parse_mode: 'HTML' });

                // Сразу переводим в режим ожидания логина
                userStates[chatId] = { state: 'awaiting_hemis_login' };
                await bot.sendMessage(chatId, i18n.t(language, 'enterHemisLogin'), {
                    parse_mode: 'HTML',
                    ...keyboards.removeKeyboard
                });
            }
        } catch (error) {
            // Если ошибка при получении языка, показываем выбор языка
            bot.sendMessage(chatId, i18n.t('ru-RU', 'selectLanguage'), keyboards.getLanguageSelectionKeyboard());
        }
    });

    // --- ЛОГИКА АВТОРИЗАЦИИ (БЕЗОПАСНАЯ) ---
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;

        if (!text || text.startsWith('/') || msg.chat.type !== 'private') return;

        const language = await getUserLanguage(chatId);

        // Безопасная проверка кнопок (для обоих языков)
        const mainMenuRu = keyboards.getMainMenu('ru-RU').reply_markup.keyboard;
        const mainMenuUz = keyboards.getMainMenu('uz-UZ').reply_markup.keyboard;
        const guestMenuRu = keyboards.getGuestMenu('ru-RU').reply_markup.keyboard;
        const guestMenuUz = keyboards.getGuestMenu('uz-UZ').reply_markup.keyboard;
        const allButtons = new Set([...mainMenuRu, ...mainMenuUz, ...guestMenuRu, ...guestMenuUz].flat());

        if (allButtons.has(text)) return;

        if (!userStates[chatId]) return;

        if (userStates[chatId].state === 'awaiting_hemis_login') {
            userStates[chatId].hemisLogin = text;
            userStates[chatId].state = 'awaiting_hemis_password';
            bot.sendMessage(chatId, i18n.t(language, 'enterHemisPassword'), { parse_mode: 'HTML', ...keyboards.removeKeyboard });
        }
        else if (userStates[chatId].state === 'awaiting_hemis_password') {
            const { hemisLogin } = userStates[chatId];
            delete userStates[chatId];

            bot.deleteMessage(chatId, msg.message_id).catch(() => { });
            const loading = await bot.sendMessage(chatId, i18n.t(language, 'checkingData'));

            try {
                const response = await axios.post(`${apiUrl}/api/bot/register`, {
                    hemisLogin,
                    hemisPassword: text,
                    chatId: chatId.toString()
                }, { headers: { 'x-bot-secret': botApiSecret } });

                if (response.data.success) {
                    bot.deleteMessage(chatId, loading.message_id).catch(() => { });
                    bot.sendMessage(chatId, `${i18n.t(language, 'accountLinked')}\n\n${i18n.t(language, 'selectAction')}`, keyboards.getMainMenu(language));
                }
            } catch (error) {
                bot.deleteMessage(chatId, loading.message_id).catch(() => { });
                const msgErr = error.response?.status === 401 ? i18n.t(language, 'wrongCredentials') : i18n.t(language, 'serverError');
                bot.sendMessage(chatId, `${msgErr} ${i18n.t(language, 'tryAgain')}.`, keyboards.getGuestMenu(language));
            }
        }
    });

    // --- КРОН ---
    cron.schedule('0 7 * * *', async () => {
        try {
            const today = new Date();
            await processAndSendGlobal(today);
        } catch (error) {
            console.error('Error in morning schedule cron:', error);
        }
    }, { scheduled: true, timezone: "Asia/Tashkent" });

    cron.schedule('0 19 * * *', async () => {
        try {
            const today = new Date();
            if (today.getDay() === 6) return;
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            await processAndSendGlobal(tomorrow);
        } catch (error) {
            console.error('Error in evening schedule cron:', error);
        }
    }, { scheduled: true, timezone: "Asia/Tashkent" });

    // --- ПРОВЕРКА НОВЫХ NB (Каждые 30 минут) ---
    cron.schedule('*/30 * * * *', async () => {
        try {
            // Запрашиваем у бэкенда список тех, у кого новые NB
            const response = await axios.post(`${apiUrl}/api/bot/check-new-absences`, {}, {
                headers: { 'x-bot-secret': botApiSecret }
            });

            const notifications = response.data.notifications;

            if (notifications && notifications.length > 0) {
                console.log(`Найдено ${notifications.length} новых NB. Рассылаю...`);

                for (const notify of notifications) {
                    // Получаем язык пользователя для уведомления
                    let userLanguage = 'ru-RU';
                    try {
                        const { data } = await axios.get(`${apiUrl}/api/bot/language/${notify.chatId}`, {
                            headers: { 'x-bot-secret': botApiSecret }
                        });
                        userLanguage = data.language || 'ru-RU';
                    } catch (e) {
                        // Используем язык по умолчанию
                    }

                    const locale = userLanguage === 'uz-UZ' ? 'uz-UZ' : 'ru-RU';
                    let msg = `⚠️ <b>${i18n.t(userLanguage, 'newAbsenceWarning')}</b>\n\n`;

                    if (notify.latestSubject) {
                        const dateObj = new Date(notify.latestDate * 1000);
                        const dateStr = dateObj.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
                        msg += `📚 <b>${i18n.t(userLanguage, 'subject')}:</b> ${notify.latestSubject}\n`;
                        msg += `📅 <b>${i18n.t(userLanguage, 'date')}:</b> ${dateStr}\n`;
                    }

                    msg += `📈 <b>${i18n.t(userLanguage, 'added')}:</b> +${notify.diff} ${i18n.t(userLanguage, 'hours')}\n`;
                    msg += `🔴 <b>${i18n.t(userLanguage, 'totalAbsences')}:</b> ${notify.total} ${i18n.t(userLanguage, 'hours')}\n\n`;
                    msg += `<i>${i18n.t(userLanguage, 'checkDetails')}</i>`;
                    msg += `\n\n👉 @HEMISnotify_bot`;

                    try {
                        await bot.sendMessage(notify.chatId, msg, { parse_mode: 'HTML' });
                    } catch (sendErr) {
                        console.error(`Не удалось отправить NB юзеру ${notify.chatId}:`, sendErr.message);
                    }
                }
            }
        } catch (error) {
            console.error('Ошибка Cron проверки NB:', error.message);
        }
    }, { scheduled: true, timezone: "Asia/Tashkent" });



    async function processAndSendGlobal(dateObject) {
        try {
            const { data: groups } = await axios.get(`${apiUrl}/api/bot/groups`, { headers: { 'x-bot-secret': botApiSecret } });
            for (const group of groups) {
                try {
                    const { data: scheduleData } = await axios.get(`${apiUrl}/api/bot/schedule/group/${encodeURIComponent(group.groupName)}`, { headers: { 'x-bot-secret': botApiSecret } });
                    const daySchedule = scheduleData.schedule.filter(item => {
                        const d = new Date(item.lesson_date * 1000);
                        return d.getFullYear() === dateObject.getFullYear() && d.getMonth() === dateObject.getMonth() && d.getDate() === dateObject.getDate();
                    });
                    // Для групповых рассылок используем русский язык по умолчанию
                    const msg = formatSchedule(daySchedule, 'student', dateObject, group.groupName, 'ru-RU');
                    const sent = await bot.sendMessage(group.telegramChatId, msg, { parse_mode: 'HTML' });
                    await bot.pinChatMessage(sent.chat.id, sent.message_id, { disable_notification: false });
                } catch (e) { console.error(`Ошибка группы ${group.groupName}:`, e.message); }
            }
        } catch (e) { console.error("Ошибка массовой рассылки:", e.message); }
    }

    bot.onText(/\/bind_group (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!['group', 'supergroup'].includes(msg.chat.type)) return;

        // Для групп используем язык по умолчанию (русский), так как пользователя может не быть в базе
        let language = 'ru-RU';
        try {
            language = await getUserLanguage(chatId);
        } catch (e) {
            // Если не удалось получить язык, используем русский по умолчанию
        }

        try {
            const member = await bot.getChatMember(chatId, msg.from.id);
            if (!['creator', 'administrator'].includes(member.status)) {
                return bot.sendMessage(chatId, i18n.t(language, 'onlyAdmins'));
            }
            const res = await axios.post(`${apiUrl}/api/bot/bind-group`, {
                groupName: match[1].trim(),
                chatId: chatId.toString()
            }, {
                headers: { 'x-bot-secret': botApiSecret }
            });
            if (res.data.success) {
                bot.sendMessage(chatId, `✅ ${res.data.message}`);
            }
        } catch (e) {
            const errorMsg = e.response?.data?.message || e.message;
            bot.sendMessage(chatId, `${i18n.t(language, 'error')}: ${errorMsg}`);
        }
    });
}

module.exports = { startBot };
