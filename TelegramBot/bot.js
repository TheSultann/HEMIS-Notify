// TelegramBot/bot.js

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');

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

    // --- ИЗМЕНЕНО: Устанавливаем меню команд для удобства ---
    bot.setMyCommands([
        { command: '/start', description: '🚀 Перезапустить бота' },
        { command: '/schedule_today', description: '📅 Расписание на сегодня' },
        { command: '/schedule_tomorrow', description: '🗓️ Расписание на завтра' },
        { command: '/login', description: '🔄 Сменить аккаунт HEMIS' },
        { command: '/help', description: 'ℹ️ Помощь' }
    ]);

    const userStates = {};

    // --- Функции-помощники (без изменений) ---
    function formatSchedule(schedule, title, role, dateObject) {
        const formattedDate = dateObject.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long'
        });
        if (!schedule || schedule.length === 0) {
            return `<b>${title} (${formattedDate}):</b>\n\nЗанятий нет. Можно отдыхать! 🎉`;
        }
        schedule.sort((a, b) => a.time.localeCompare(b.time));
        let message = `<b>${title} (${formattedDate}):</b>\n\n`;
        schedule.forEach(item => {
            message += `🕒 <b>${item.time}</b>\n`;
            message += `📚 ${item.subjectId.name}\n`;
            if (item.subjectId.lessonType) message += `🏷️ ${item.subjectId.lessonType}\n`;
            if (role === 'teacher') message += `👥 ${item.subjectId.groupName}\n`;
            else message += `👤 ${item.subjectId.teacherName}\n`;
            message += `🚪 ${item.subjectId.auditoriumName}\n`;
            message += `--------------------\n`;
        });
        return message;
    }

    async function processAndSendSchedule(dateObject, title) {
        console.log(`[${new Date().toLocaleString()}] Запуск рассылки: "${title}"`);
        try {
            const { data: subscribers } = await axios.get(`${apiUrl}/api/bot/subscribers`, {
                headers: { 'x-bot-secret': botApiSecret }
            });
            if (subscribers.length === 0) {
                console.log("Подписчики не найдены. Рассылка пропущена.");
                return;
            }
            console.log(`Найдено подписчиков: ${subscribers.length}`);
            for (const subscriber of subscribers) {
                try {
                    const { data: scheduleData } = await axios.get(`${apiUrl}/api/bot/schedule/${subscriber.telegramChatId}`, {
                        headers: { 'x-bot-secret': botApiSecret }
                    });
                    const daySchedule = scheduleData.schedule.filter(item => {
                        const lessonDate = new Date(item.lesson_date * 1000);
                        return lessonDate.getFullYear() === dateObject.getFullYear() &&
                               lessonDate.getMonth() === dateObject.getMonth() &&
                               lessonDate.getDate() === dateObject.getDate();
                    });
                    const message = formatSchedule(daySchedule, title, subscriber.role, dateObject);
                    await bot.sendMessage(subscriber.telegramChatId, message, { parse_mode: 'HTML' });
                    console.log(`Сообщение "${title}" успешно отправлено пользователю ${subscriber.telegramChatId}`);
                } catch (error) {
                    console.error(`Ошибка при обработке пользователя ${subscriber.telegramChatId}:`, error.response?.data?.message || error.message);
                }
            }
            console.log(`Рассылка "${title}" завершена.`);
        } catch (error) {
            console.error(`Критическая ошибка при выполнении рассылки "${title}":`, error.message);
        }
    }

    async function processAndSendScheduleForUser(chatId, dateObject, title) {
        try {
            const { data: scheduleData } = await axios.get(`${apiUrl}/api/bot/schedule/${chatId}`, {
                headers: { 'x-bot-secret': botApiSecret }
            });
            const daySchedule = scheduleData.schedule.filter(item => {
                const lessonDate = new Date(item.lesson_date * 1000);
                return lessonDate.getFullYear() === dateObject.getFullYear() &&
                       lessonDate.getMonth() === dateObject.getMonth() &&
                       lessonDate.getDate() === dateObject.getDate();
            });
            const message = formatSchedule(daySchedule, title, scheduleData.role, dateObject);
            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        } catch (error) {
            console.error(`Ошибка при отправке для ${chatId}:`, error.message);
            bot.sendMessage(chatId, "Не удалось получить расписание. Возможно, ваш аккаунт еще не привязан. Используйте /login.");
        }
    }

    // --- Планировщики Cron (без изменений) ---
    cron.schedule('0 7 * * *', () => processAndSendSchedule(new Date(), "Расписание на сегодня"), { scheduled: true, timezone: "Asia/Tashkent" });
    console.log('Утренний планировщик настроен на 7:00.');
    cron.schedule('0 19 * * *', () => {
        const today = new Date();
        if (today.getDay() === 6) {
            console.log("Сегодня суббота, вечерняя рассылка на завтра (воскресенье) пропущена.");
            return;
        }
        const tomorrowDate = new Date();
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        processAndSendSchedule(tomorrowDate, "Расписание на завтра");
    }, { scheduled: true, timezone: "Asia/Tashkent" });
    console.log('Вечерний планировщик настроен на 19:00.');

    // --- НОВАЯ ЛОГИКА: Обработчик кнопок ---
    bot.on('callback_query', (callbackQuery) => {
        const msg = callbackQuery.message;
        const data = callbackQuery.data;
        bot.answerCallbackQuery(callbackQuery.id); // Убираем "часики" на кнопке

        if (data === 'link_account') {
            userStates[msg.chat.id] = { state: 'awaiting_hemis_login' };
            bot.sendMessage(msg.chat.id, "Пожалуйста, введите ваш логин от системы HEMIS (обычно это ID студента):");
        }
        if (data === 'schedule_today') {
            bot.sendMessage(msg.chat.id, "Загружаю расписание на сегодня...");
            processAndSendScheduleForUser(msg.chat.id, new Date(), "Расписание на сегодня");
        }
        if (data === 'schedule_tomorrow') {
            bot.sendMessage(msg.chat.id, "Загружаю расписание на завтра...");
            const tomorrowDate = new Date();
            tomorrowDate.setDate(tomorrowDate.getDate() + 1);
            processAndSendScheduleForUser(msg.chat.id, tomorrowDate, "Расписание на завтра");
        }
    });

    // --- ИЗМЕНЕНО: "Умная" команда /start ---
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        delete userStates[chatId];

        try {
            // Проверяем, зарегистрирован ли пользователь
            const response = await axios.get(`${apiUrl}/api/bot/schedule/${chatId}`, {
                headers: { 'x-bot-secret': botApiSecret }
            });
            
            // Если пользователь найден (код 200)
            const userName = response.data.schedule[0]?.subjectId?.studentName || "студент"; // Пытаемся получить имя
            bot.sendMessage(chatId, `👋 С возвращением!`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📅 Расписание на сегодня', callback_data: 'schedule_today' }],
                        [{ text: '🗓️ Расписание на завтра', callback_data: 'schedule_tomorrow' }],
                        [{ text: '🔄 Сменить аккаунт HEMIS', callback_data: 'link_account' }]
                    ]
                }
            });

        } catch (error) {
            // Если пользователь не найден (ошибка 404)
            if (error.response && error.response.status === 404) {
                const welcomeMessage = `<b>Добро пожаловать в Mini-HEMIS бот!</b>\n\nЯ буду автоматически присылать вам расписание.\n\nДля начала работы, пожалуйста, привяжите ваш аккаунт.`;
                bot.sendMessage(chatId, welcomeMessage, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔗 Привязать аккаунт HEMIS', callback_data: 'link_account' }]
                        ]
                    }
                });
            } else {
                // Другие ошибки
                console.error("Ошибка в /start:", error.message);
                bot.sendMessage(chatId, "Произошла ошибка. Попробуйте позже.");
            }
        }
    });

    // Команда /login теперь в основном для смены аккаунта
    bot.onText(/\/login/, (msg) => {
        const chatId = msg.chat.id;
        userStates[chatId] = { state: 'awaiting_hemis_login' };
        bot.sendMessage(chatId, "Пожалуйста, введите ваш новый логин от системы HEMIS:");
    });

    bot.onText(/\/help/, (msg) => {
        const helpMessage = `<b>ℹ️ Помощь</b>\n\nЭтот бот предназначен для автоматической отправки вашего расписания из системы HEMIS.\n\n- Утром (в 11:00) вы получите расписание на сегодня.\n- Вечером (в 19:00) - на завтра.\n\nВы также можете использовать команды из меню (значок "/") для получения расписания в любой момент.`;
        bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'HTML' });
    });

    // Эти команды оставлены для прямого вызова из меню
    bot.onText(/\/schedule_today/, (msg) => {
        bot.sendMessage(msg.chat.id, "Загружаю расписание на сегодня...");
        processAndSendScheduleForUser(msg.chat.id, new Date(), "Расписание на сегодня");
    });

    bot.onText(/\/schedule_tomorrow/, (msg) => {
        bot.sendMessage(msg.chat.id, "Загружаю расписание на завтра...");
        const tomorrowDate = new Date();
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        processAndSendScheduleForUser(msg.chat.id, tomorrowDate, "Расписание на завтра");
    });

    // Обработчик сообщений для логина (без изменений)
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        if (text.startsWith('/')) return;
        const currentState = userStates[chatId];
        if (!currentState) return;

        if (currentState.state === 'awaiting_hemis_login') {
            currentState.hemisLogin = text;
            currentState.state = 'awaiting_hemis_password';
            bot.sendMessage(chatId, "Отлично. Теперь введите ваш пароль от HEMIS. \n\n⚠️ Сообщение с паролем будет удалено для безопасности.");
        } else if (currentState.state === 'awaiting_hemis_password') {
            const { hemisLogin } = currentState;
            const hemisPassword = text;
            delete userStates[chatId];
            bot.deleteMessage(chatId, msg.message_id).catch(err => console.log("Не удалось удалить сообщение."));
            bot.sendMessage(chatId, "Проверяю данные в HEMIS, это может занять несколько секунд...");

            try {
                const response = await axios.post(`${apiUrl}/api/bot/register`, {
                    hemisLogin,
                    hemisPassword,
                    chatId: chatId.toString()
                }, { headers: { 'x-bot-secret': botApiSecret } });

                if (response.data.success) {
                    bot.sendMessage(chatId, `✅ ${response.data.message}\n\nТеперь вы будете получать уведомления. Чтобы увидеть расписание прямо сейчас, используйте кнопки ниже.`, {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📅 Расписание на сегодня', callback_data: 'schedule_today' }],
                                [{ text: '🗓️ Расписание на завтра', callback_data: 'schedule_tomorrow' }]
                            ]
                        }
                    });
                }
            } catch (error) {
                const status = error.response?.status;
                const message = error.response?.data?.message || "Произошла ошибка.";
                if (status === 401) {
                    bot.sendMessage(chatId, `❌ Ошибка: ${message}. Проверьте логин и пароль и попробуйте снова: /login`);
                } else {
                    bot.sendMessage(chatId, `❌ Произошла ошибка на сервере (${status}). Попробуйте позже.`);
                }
            }
        }
    });
}

module.exports = { startBot };