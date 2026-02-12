// TelegramBot/bot.js

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');
const keyboards = require('./keyboards');
const i18n = require('./i18n');

function startBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const botApiSecret = process.env.BOT_API_SECRET;
    const port = process.env.PORT || 5000;

    // Используем localhost вместо внешнего URL, чтобы обойти Cloudflare
    // Бот и сервер работают в одном процессе — внешний запрос не нужен
    const apiUrl = `http://localhost:${port}`;

    if (!token || !botApiSecret) {
        console.error('Ошибка: TELEGRAM_BOT_TOKEN или BOT_API_SECRET не найдены!');
        process.exit(1);
    }
    const bot = new TelegramBot(token, { polling: true });
    console.log('Телеграм-бот запущен...');


    (async () => {
        try {
            // 1. Дефолт (пусто или минимум)
            await bot.setMyCommands([
                { command: '/start', description: '👋 Перезапуск' }
            ], { scope: { type: 'default' } });

            // 2. Для ОБЫЧНЫХ участников групп (только расписание)
            await bot.setMyCommands([
                { command: '/start', description: '👋 Приветствие' },
                { command: '/schedule_today', description: '📅 Расписание группы' },
                { command: '/schedule_tomorrow', description: '📅 Расписание на завтра' },
                { command: '/bind_me', description: '🔗 Привязать мою группу' },
                { command: '/unbind_group', description: '❌ Отвязать группу' }
            ], { scope: { type: 'all_group_chats' } });

            // 3. Для АДМИНОВ групп (добавляем Unbind)
            await bot.setMyCommands([
                { command: '/start', description: '👋 Приветствие' },
                { command: '/schedule_today', description: '📅 Расписание группы' },
                { command: '/schedule_tomorrow', description: '📅 Расписание на завтра' },
                { command: '/bind_me', description: '🔗 Привязать мою группу' },
                { command: '/unbind_group', description: '❌ Отвязать группу' } // <--- НОВАЯ

            ], { scope: { type: 'all_chat_administrators' } });

            // 4. Для ЛИЧКИ (полный доступ)
            await bot.setMyCommands([
                { command: '/start', description: '🏠 Главное меню' },
                { command: '/schedule_today', description: '📅 Расписание на сегодня' },
                { command: '/schedule_tomorrow', description: '📅 Расписание на завтра' },
                { command: '/me', description: '👤 Мой профиль' },
                { command: '/login', description: '🔑 Вход в систему' },
                { command: '/logout', description: '🚪 Выйти из системы' }
            ], { scope: { type: 'all_private_chats' } });

            console.log('✅ Меню команд обновлено (unbind добавлен админам).');
        } catch (error) {
            console.error('❌ Ошибка при обновлении меню:', error.message);
        }
    })();

    const userStates = {};
    const USER_STATE_TTL_MS = 60 * 60 * 1000; // 1 час
    setInterval(() => {
        const now = Date.now();
        Object.keys(userStates).forEach((id) => {
            const ts = userStates[id]?.ts;
            if (ts && now - ts > USER_STATE_TTL_MS) {
                delete userStates[id];
            }
        });
    }, 10 * 60 * 1000); // проверяем каждые 10 минут

    bot.on('message', (msg) => {
        if (msg.chat.type === 'private') trackActivity(msg.chat.id);
    });
    bot.on('callback_query', (query) => {
        if (query.message.chat.type === 'private') trackActivity(query.message.chat.id);
    });

    // Функция отправки "маячка" на сервер
    async function trackActivity(chatId) {
        try {
            await axios.post(`${apiUrl}/api/bot/activity`, {
                chatId: chatId.toString()
            }, { headers: { 'x-bot-secret': botApiSecret } });
        } catch (e) {
            // Игнорируем ошибки (не страшно, если статистика пропустит один клик)
        }
    }

    // Отслеживание блокировки бота пользователем
    bot.on('my_chat_member', async (u) => {
        if (u.new_chat_member.status === 'kicked') {
            // Юзер заблокировал бота -> шлем isBlocked: true
            try {
                await axios.post(`${apiUrl}/api/bot/activity`, {
                    chatId: u.chat.id.toString(),
                    isBlocked: true
                }, { headers: { 'x-bot-secret': botApiSecret } });
            } catch (e) { }
        } else if (u.new_chat_member.status === 'member') {
            // Юзер разблокировал бота -> шлем isBlocked: false
            try {
                await axios.post(`${apiUrl}/api/bot/activity`, {
                    chatId: u.chat.id.toString(),
                    isBlocked: false
                }, { headers: { 'x-bot-secret': botApiSecret } });
            } catch (e) { }
        }
    });

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

    // Selects admin or user menu based on chat ID
    function getMenuKeyboard(chatId, language) {
        const adminId = process.env.ADMIN_ID;
        return (String(chatId) === String(adminId))
            ? keyboards.getAdminMenu(language)
            : keyboards.getMainMenu(language);
    }

    // --- Глобальный троттлинг отправок, чтобы не ловить FloodWait при массовых рассылках ---
    const GLOBAL_INTERVAL_MS = 60;     // ~16 msg/сек на бота
    const PER_CHAT_INTERVAL_MS = 1100; // <=1 msg/сек на чат
    let lastGlobalSend = 0;
    const lastChatSend = new Map();

    const sleep = (ms) => new Promise(res => setTimeout(res, ms));

    async function waitForSlot(chatId) {
        const now = Date.now();
        const waitGlobal = Math.max(0, lastGlobalSend + GLOBAL_INTERVAL_MS - now);
        const lastChatTime = lastChatSend.get(chatId) || 0;
        const waitChat = Math.max(0, lastChatTime + PER_CHAT_INTERVAL_MS - now);
        const wait = Math.max(waitGlobal, waitChat);
        if (wait > 0) await sleep(wait);
        const ts = Date.now();
        lastGlobalSend = ts;
        lastChatSend.set(chatId, ts);
    }

    async function sendSafe(chatId, text, options) {
        let attempts = 0;
        let lastError = null;
        while (attempts < 3) {
            try {
                await waitForSlot(chatId);
                return await bot.sendMessage(chatId, text, options);
            } catch (e) {
                lastError = e;
                const retryAfter = e?.response?.body?.parameters?.retry_after;
                if (e?.response?.statusCode === 429 && retryAfter) {
                    await sleep(retryAfter * 1000 + 100);
                    attempts++;
                    continue;
                }
                throw e;
            }
        }
        console.error(`sendSafe: exhausted retries for chat ${chatId}`, lastError?.message || lastError);
        throw lastError || new Error('sendSafe: retry limit reached');
    }

    async function pinSafe(chatId, messageId, options) {
        let attempts = 0;
        let lastError = null;
        while (attempts < 3) {
            try {
                await waitForSlot(chatId);
                return await bot.pinChatMessage(chatId, messageId, options);
            } catch (e) {
                lastError = e;
                const retryAfter = e?.response?.body?.parameters?.retry_after;
                if (e?.response?.statusCode === 429 && retryAfter) {
                    await sleep(retryAfter * 1000 + 100);
                    attempts++;
                    continue;
                }
                throw e;
            }
        }
        console.error(`pinSafe: exhausted retries for chat ${chatId}`, lastError?.message || lastError);
        throw lastError || new Error('pinSafe: retry limit reached');
    }

    function formatSchedule(schedule, role, dateObject, groupName, language = 'ru-RU') {
        // Современный компактный формат расписания
        const locale = language === 'uz-UZ' ? 'uz-UZ' : 'ru-RU';
        const dateStr = dateObject.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
        const weekday = dateObject.toLocaleDateString(locale, { weekday: 'long' });

        let message = `🗓️ <b>${weekday}, ${dateStr}</b>\n`;
        if (groupName) {
            message += `👥 <b>${i18n.t(language, 'group')}:</b> ${groupName}\n`;
        }
        message += `\n`;

        if (!schedule || schedule.length === 0) {
            message += i18n.t(language, 'noLessons');
            message += `\n👉 @HEMISnotify_bot`;
            return message;
        }

        // Сортируем и рисуем карточки слотов
        schedule.sort((a, b) => a.time.localeCompare(b.time));
        schedule.forEach((item, idx) => {
            message += `━ ${idx + 1} ━━━━━━━━━━━━━\n`;
            message += `🕒 <b>${item.time}</b>\n`;
            message += `📚 <b>${item.subjectId.name}</b>\n`;
            if (item.subjectId.lessonType) message += `🏷️ ${item.subjectId.lessonType}\n`;
            if (role === 'teacher') {
                message += `👥 ${item.subjectId.groupName}\n`;
            } else {
                message += `👤 ${item.subjectId.teacherName}\n`;
            }
            message += `🚪 ${item.subjectId.auditoriumName}\n`;
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
                    await bot.sendMessage(chatId, i18n.t(language, 'welcomeBack'), getMenuKeyboard(chatId, language));
                } catch (error) {
                    // ЕСЛИ НЕ ЗАРЕГИСТРИРОВАН -> БЕСШОВНЫЙ ОНБОРДИНГ
                    await bot.sendMessage(chatId, i18n.t(language, 'welcomeOnboarding'), { parse_mode: 'HTML' });

                    // Сразу переводим в режим ожидания логина
                    userStates[chatId] = { state: 'awaiting_hemis_login', ts: Date.now() };
                    await bot.sendMessage(chatId, i18n.t(language, 'enterHemisLogin'), {
                        parse_mode: 'HTML',
                        ...keyboards.removeKeyboard
                    });
                }
            }
        }
    });

    // Отдельный слушатель для Админских кнопок (Рассылка)
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const data = query.data;
        const ADMIN_ID = process.env.ADMIN_ID;

        // Если это не админ или не наши кнопки - игнорируем
        if (String(chatId) !== String(ADMIN_ID) || !data.startsWith('bc_')) return;

        await bot.answerCallbackQuery(query.id);

        // 1. Выбрали аудиторию -> Просим текст
        if (data === 'bc_target_students' || data === 'bc_target_groups') {
            const target = data === 'bc_target_students' ? 'students' : 'groups';

            // Запоминаем состояние: ждем текст для конкретной цели
            userStates[chatId] = {
                state: 'awaiting_broadcast_text',
                target: target,
                ts: Date.now()
            };

            await bot.editMessageText(`✍️ <b>Введите текст сообщения для рассылки (${target === 'students' ? 'Студентам' : 'Группам'}):</b>\n\n<i>Можно использовать HTML теги, ссылки и смайлики.</i>`, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
            });
        }

        // 2. Отмена
        else if (data === 'bc_cancel') {
            delete userStates[chatId];
            await bot.deleteMessage(chatId, query.message.message_id).catch(() => { });
            await bot.sendMessage(chatId, '❌ Рассылка отменена.');
        }

        // 3. Подтверждение отправки
        else if (data === 'bc_send') {
            const draft = userStates[chatId];
            if (!draft || (!draft.text && !draft.photo)) {
                return bot.sendMessage(chatId, 'Ошибка: данные рассылки устарели.');
            }

            // Удаляем превью (сообщение с кнопкой), чтобы было красиво
            await bot.deleteMessage(chatId, query.message.message_id).catch(() => { });
            const loadingMsg = await bot.sendMessage(chatId, '⏳ <b>Начинаю рассылку...</b>', { parse_mode: 'HTML' });

            try {
                // Получаем список ID
                const endpoint = draft.target === 'students' ? '/api/bot/subscribers' : '/api/bot/groups';
                const { data: list } = await axios.get(`${apiUrl}${endpoint}`, {
                    headers: { 'x-bot-secret': botApiSecret }
                });

                let successCount = 0;
                let failCount = 0;

                // Отправляем
                for (const item of list) {
                    try {
                        if (draft.photo) {
                            // Если есть фото
                            await bot.sendPhoto(item.telegramChatId, draft.photo, { caption: draft.text, parse_mode: 'HTML' });
                        } else {
                            // Если только текст
                            await bot.sendMessage(item.telegramChatId, draft.text, { parse_mode: 'HTML' });
                        }
                        successCount++;
                    } catch (e) {
                        failCount++;
                    }
                    // Пауза 30мс
                    await new Promise(resolve => setTimeout(resolve, 30));
                }

                delete userStates[chatId];

                await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => { });
                await bot.sendMessage(chatId, `✅ <b>Рассылка завершена!</b>\n\n📨 Отправлено: ${successCount}\n🚫 Ошибок/Блоков: ${failCount}`, { parse_mode: 'HTML' });

            } catch (error) {
                console.error('Broadcast error:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при выполнении рассылки.');
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
        userStates[msg.chat.id] = { state: 'awaiting_hemis_login', ts: Date.now() };
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
            `/bind_me\n\n` +
            `Misol:\n\n` +
            `/bind_me\n\n` +
            `Bog'langanidan keyin jadval avtomatik ravishda guruhga keladi.`
            : `ℹ️ Помощь\n\n` +
            `Этот бот автоматически отправляет ваше расписание из системы HEMIS.\n\n` +
            `⏰ Автоматическая рассылка:\n\n` +
            `🕖 7:00 — расписание на сегодня\n\n` +
            `🌙 19:00 — расписание на завтра\n\n` +
            `📚 Для групповых чатов:\n\n` +
            `Администратор может привязать чат к академической группе\n` +
            `командой:\n\n` +
            `/bind_me\n\n` +
            `Пример:\n\n` +
            `/bind_me\n\n` +
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

    // --- КОМАНДА /LOGOUT ---
    bot.onText(/\/logout/, async (msg) => {
        const chatId = msg.chat.id;
        const language = await getUserLanguage(chatId);

        if (msg.chat.type !== 'private') return;
        try {
            // 1. Отправляем запрос на удаление
            await axios.post(`${apiUrl}/api/bot/logout`, {
                chatId: chatId.toString()
            }, {
                headers: { 'x-bot-secret': botApiSecret }
            });

            // 2. Чистим локальное состояние
            delete userStates[chatId];

            // 3. Пишем сообщение и показываем кнопку входа
            // (текст loggedOut нужно добавить в i18n.js, или напиши тут просто "Вы вышли.")
            const text = language === 'uz-UZ' ? 'Tizimdan chiqdingiz.' : 'Вы вышли из системы.';

            await bot.sendMessage(chatId, `✅ ${text}`, keyboards.getGuestMenu(language));

        } catch (error) {
            console.error('Logout error:', error.message);
            const errText = language === 'uz-UZ' ? 'Xatolik yuz berdi.' : 'Произошла ошибка.';
            bot.sendMessage(chatId, errText);
        }
    });



    // --- КОМАНДА /START ---
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const ADMIN_ID = process.env.ADMIN_ID; // Получаем ID из .env

        if (msg.chat.type !== 'private') {
            const language = await getUserLanguage(chatId);
            return bot.sendMessage(chatId, i18n.t(language, 'helloGroup'));
        }

        delete userStates[chatId];

        try {
            const { data } = await axios.get(`${apiUrl}/api/bot/language/${chatId}`, {
                headers: { 'x-bot-secret': botApiSecret }
            });

            if (!data.language) {
                return bot.sendMessage(chatId, i18n.t('ru-RU', 'selectLanguage'), keyboards.getLanguageSelectionKeyboard());
            }

            const language = data.language;

            // Выбираем клавиатуру: Админская или Обычная
            const menuKeyboard = (String(chatId) === String(ADMIN_ID))
                ? keyboards.getAdminMenu(language)
                : keyboards.getMainMenu(language);

            try {
                await axios.get(`${apiUrl}/api/bot/schedule/${chatId}`, { headers: { 'x-bot-secret': botApiSecret } });
                bot.sendMessage(chatId, i18n.t(language, 'welcomeBack'), menuKeyboard);
            } catch (error) {
                // Если не зарегистрирован
                await bot.sendMessage(chatId, i18n.t(language, 'welcomeOnboarding'), { parse_mode: 'HTML' });
                userStates[chatId] = { state: 'awaiting_hemis_login', ts: Date.now() };
                await bot.sendMessage(chatId, i18n.t(language, 'enterHemisLogin'), {
                    parse_mode: 'HTML',
                    ...keyboards.removeKeyboard
                });
            }
        } catch (error) {
            bot.sendMessage(chatId, i18n.t('ru-RU', 'selectLanguage'), keyboards.getLanguageSelectionKeyboard());
        }
    });

    // Кнопка "📊 Статистика" (Расширенная)
    bot.onText(/📊 Статистика/, async (msg) => {
        const chatId = msg.chat.id;
        const ADMIN_ID = process.env.ADMIN_ID;

        if (String(chatId) !== String(ADMIN_ID)) return;

        try {
            const { data } = await axios.get(`${apiUrl}/api/bot/stats`, {
                headers: { 'x-bot-secret': botApiSecret }
            });

            // Красивое форматирование
            const { audience, growth, activity, system } = data;

            const text = `📊 <b>РАСШИРЕННАЯ СТАТИСТИКА</b>\n\n` +
                `👥 <b>Аудитория:</b>\n` +
                `• Всего в базе: <b>${audience.total}</b>\n` +
                `• Живые: <b>${audience.active}</b>\n` +
                `• 💀 Блок: <b>${audience.blocked}</b>\n\n` +

                `📈 <b>Прирост (Сегодня / Неделя):</b>\n` +
                `• Новые: <b>+${growth.today}</b> / <b>+${growth.week}</b>\n\n` +

                `🔥 <b>Активность:</b>\n` +
                `• Сегодня (DAU): <b>${activity.dau}</b>\n` +
                `• За неделю (WAU): <b>${activity.wau}</b>\n` +
                `• 💤 Спящие (>30д): <b>${activity.sleeping}</b>\n\n` +

                `💻 <b>Система:</b>\n` +
                `• Групп: <b>${system.groups}</b>\n` +
                `• Чатов: <b>${system.chats}</b>`;

            bot.sendMessage(chatId, text, { parse_mode: 'HTML' });

        } catch (error) {
            console.error('Stats error:', error.message);
            bot.sendMessage(chatId, 'Ошибка получения статистики.');
        }
    });

    // Кнопка "📢 Рассылка" (Только Админ)
    bot.onText(/📢 Рассылка/, async (msg) => {
        const chatId = msg.chat.id;
        const ADMIN_ID = process.env.ADMIN_ID;

        if (String(chatId) !== String(ADMIN_ID)) return;

        await bot.sendMessage(chatId, '📢 <b>Выберите аудиторию для рассылки:</b>', {
            parse_mode: 'HTML',
            ...keyboards.getBroadcastTargetKeyboard()
        });
    });

    // --- КОМАНДА /BIND_ME (Авто-привязка) ---
    bot.onText(/\/bind_me/, async (msg) => {
        const groupChatId = msg.chat.id;
        const userTelegramId = msg.from.id;

        // Работает только в группах
        if (!['group', 'supergroup'].includes(msg.chat.type)) {
            return bot.sendMessage(groupChatId, 'Эта команда работает только в группах.');
        }

        // Проверяем права (опционально, можно разрешить всем студентам, но лучше админам)
        try {
            const member = await bot.getChatMember(groupChatId, userTelegramId);
            if (!['creator', 'administrator'].includes(member.status)) {
                return bot.sendMessage(groupChatId, 'Только администраторы могут привязывать группу.');
            }

            const res = await axios.post(`${apiUrl}/api/bot/bind-by-user`, {
                groupChatId: groupChatId.toString(),
                userTelegramId: userTelegramId.toString()
            }, {
                headers: { 'x-bot-secret': botApiSecret }
            });

            if (res.data.success) {
                bot.sendMessage(groupChatId, `✅ <b>Успешно!</b>\n\nГруппа <b>"${res.data.groupName}"</b> привязана к этому чату.\n(По данным студента: ${res.data.studentName})`, { parse_mode: 'HTML' });
            }

        } catch (e) {
            if (e.response?.status === 404 && e.response?.data?.message === 'user_not_found') {
                // Если юзер не найден в боте
                return bot.sendMessage(groupChatId, `❌ Вы не зарегистрированы в боте.\n\nЗайдите в ЛС к @HEMISnotify_bot, нажмите /start и войдите в систему, затем вернитесь сюда и нажмите /bind_me.`);
            }

            const errorMsg = e.response?.data?.message || e.message;
            bot.sendMessage(groupChatId, `❌ Ошибка: ${errorMsg}`);
        }
    });


    // --- ЛОГИКА АВТОРИЗАЦИИ И РАССЫЛКИ ---
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text || msg.caption; // Берем текст ИЛИ подпись к фото

        // Проверяем состояние
        const state = userStates[chatId]?.state;

        // 1. ЛОВИМ КОНТЕНТ ДЛЯ РАССЫЛКИ (Текст или Фото)
        if (state === 'awaiting_broadcast_text') {
            const target = userStates[chatId].target;

            // Сохраняем данные
            userStates[chatId].text = text || ''; // Текст может быть пустым, если просто фото
            userStates[chatId].photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null; // ID самой большой фотки

            // Если прислали ерунду (ни текста, ни фото)
            if (!userStates[chatId].text && !userStates[chatId].photo) {
                return bot.sendMessage(chatId, '❌ Отправьте текст или фото.');
            }

            userStates[chatId].state = 'awaiting_broadcast_confirm';
            userStates[chatId].ts = Date.now();

            // Показываем предпросмотр
            const confirmKb = keyboards.getBroadcastConfirmKeyboard();
            const caption = `📢 <b>ПРЕДПРОСМОТР</b>\nTarget: ${target}\n➖➖➖\n${userStates[chatId].text}\n➖➖➖\n<i>Отправить?</i>`;

            if (userStates[chatId].photo) {
                return bot.sendPhoto(chatId, userStates[chatId].photo, { caption: caption, parse_mode: 'HTML', ...confirmKb });
            } else {
                return bot.sendMessage(chatId, caption, { parse_mode: 'HTML', ...confirmKb });
            }
        }

        // --- ДАЛЕЕ СТАНДАРТНЫЕ ПРОВЕРКИ (Игнорируем фото в обычной переписке) ---
        if (!msg.text || msg.text.startsWith('/') || msg.chat.type !== 'private') return;

        const language = await getUserLanguage(chatId);

        // Безопасная проверка кнопок
        const mainMenuRu = keyboards.getMainMenu('ru-RU').reply_markup.keyboard;
        const mainMenuUz = keyboards.getMainMenu('uz-UZ').reply_markup.keyboard;
        const guestMenuRu = keyboards.getGuestMenu('ru-RU').reply_markup.keyboard;
        const guestMenuUz = keyboards.getGuestMenu('uz-UZ').reply_markup.keyboard;
        const adminMenuRu = keyboards.getAdminMenu('ru-RU').reply_markup.keyboard;

        const allButtons = new Set([
            ...mainMenuRu, ...mainMenuUz,
            ...guestMenuRu, ...guestMenuUz,
            ...adminMenuRu
        ].flat());

        if (allButtons.has(text)) return;
        if (!userStates[chatId]) return;

        // 2. Ловим логин HEMIS
        if (state === 'awaiting_hemis_login') {
            userStates[chatId].hemisLogin = text;
            userStates[chatId].state = 'awaiting_hemis_password';
            userStates[chatId].ts = Date.now();
            bot.sendMessage(chatId, i18n.t(language, 'enterHemisPassword'), { parse_mode: 'HTML', ...keyboards.removeKeyboard });
        }
        // 3. Ловим пароль HEMIS
        else if (state === 'awaiting_hemis_password') {
            const { hemisLogin } = userStates[chatId];
            delete userStates[chatId]; // Сбрасываем состояние

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
                    bot.sendMessage(chatId, `${i18n.t(language, 'accountLinked')}\n\n${i18n.t(language, 'selectAction')}`, getMenuKeyboard(chatId, language));
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
            await processAndSendPersonal(today);
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
            await processAndSendPersonal(tomorrow);
        } catch (error) {
            console.error('Error in evening schedule cron:', error);
        }
    }, { scheduled: true, timezone: "Asia/Tashkent" });

    // --- ПРОВЕРКА НОВЫХ NB (Каждые 15 минут с 08:00 до 22:00) ---
    cron.schedule('*/15 8-22 * * *', async () => {
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
                        await sendSafe(notify.chatId, msg, { parse_mode: 'HTML' });
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
                    const sent = await sendSafe(group.telegramChatId, msg, { parse_mode: 'HTML' });
                    await pinSafe(sent.chat.id, sent.message_id, { disable_notification: false });
                } catch (e) { console.error(`Ошибка группы ${group.groupName}:`, e.message); }
            }
        } catch (e) { console.error("Ошибка массовой рассылки:", e.message); }
    }

    // Массовая рассылка в личные чаты подписчиков
    async function processAndSendPersonal(dateObject) {
        try {
            const { data: subscribers } = await axios.get(`${apiUrl}/api/bot/subscribers`, { headers: { 'x-bot-secret': botApiSecret } });
            for (const sub of subscribers) {
                const chatId = sub.telegramChatId;
                try {
                    // язык пользователя
                    let language = 'ru-RU';
                    try {
                        const { data } = await axios.get(`${apiUrl}/api/bot/language/${chatId}`, { headers: { 'x-bot-secret': botApiSecret } });
                        language = data.language || 'ru-RU';
                    } catch (langErr) { }

                    // профиль для имени группы
                    let groupName = '';
                    try {
                        const { data: profileData } = await axios.get(`${apiUrl}/api/bot/me/${chatId}`, { headers: { 'x-bot-secret': botApiSecret } });
                        groupName = profileData?.data?.group || '';
                    } catch (profileErr) { }

                    // расписание
                    const { data: scheduleData } = await axios.get(`${apiUrl}/api/bot/schedule/${chatId}`, { headers: { 'x-bot-secret': botApiSecret } });
                    const daySchedule = scheduleData.schedule.filter(item => {
                        const d = new Date(item.lesson_date * 1000);
                        return d.getFullYear() === dateObject.getFullYear() && d.getMonth() === dateObject.getMonth() && d.getDate() === dateObject.getDate();
                    });

                    const msgText = formatSchedule(daySchedule, scheduleData.role || 'student', dateObject, groupName, language);
                    await sendSafe(chatId, msgText, { parse_mode: 'HTML' });
                } catch (e) {
                    // Если у пользователя нет доступа/бот заблокирован — пропускаем
                    if (!String(e.message).includes('Forbidden')) {
                        console.error(`Ошибка личной рассылки ${chatId}:`, e.message);
                    }
                }
            }
        } catch (e) {
            console.error("Ошибка личной массовой рассылки:", e.message);
        }
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

    // --- КОМАНДА /UNBIND_GROUP (Отвязать группу) ---
    bot.onText(/\/unbind_group/, async (msg) => {
        const chatId = msg.chat.id;

        // Работает только в группах
        if (!['group', 'supergroup'].includes(msg.chat.type)) return;

        // Получаем язык (для ответов)
        let language = 'ru-RU';
        try { language = await getUserLanguage(chatId); } catch (e) { }

        try {
            // Проверка прав админа
            const member = await bot.getChatMember(chatId, msg.from.id);
            if (!['creator', 'administrator'].includes(member.status)) {
                return bot.sendMessage(chatId, i18n.t(language, 'onlyAdmins'));
            }

            // Отправляем запрос на бэкенд
            const res = await axios.post(`${apiUrl}/api/bot/unbind-group`, {
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

