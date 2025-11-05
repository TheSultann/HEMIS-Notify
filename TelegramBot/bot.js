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

    const privateCommands = [
        { command: '/start', description: '🚀 Перезапустить бота' },
        { command: '/schedule_today', description: '📅 Расписание на сегодня' },
        { command: '/schedule_tomorrow', description: '🗓️ Расписание на завтра' },
        { command: '/login', description: '🔄 Сменить аккаунт HEMIS' },
        { command: '/help', description: 'ℹ️ Помощь' }
    ];
    
    const groupCommands = [
        { command: '/start', description: '🚀 Информация о боте' },
        { command: '/schedule_today', description: '📅 Расписание на сегодня' },
        { command: '/schedule_tomorrow', description: '🗓️ Расписание на завтра' },
        { command: '/bind_group', description: '🔗 Привязать группу (только для админов)'},
        { command: '/help', description: 'ℹ️ Помощь' }
    ];

    bot.setMyCommands(privateCommands, { scope: { type: 'all_private_chats' } });
    bot.setMyCommands(groupCommands, { scope: { type: 'all_group_chats' } });

    const userStates = {};

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
        // ... (без изменений)
    }

    async function processAndSendGroupSchedules(dateObject, title) {
        // ... (без изменений)
    }

    // --- ИЗМЕНЕНО: Функция теперь принимает ID сообщения для удаления ---
    async function processAndSendScheduleForUser(chatId, dateObject, title, loadingMessageId) {
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
        } finally {
            // Удаляем сообщение "Загружаю..." в любом случае
            if (loadingMessageId) {
                bot.deleteMessage(chatId, loadingMessageId).catch(err => console.error("Не удалось удалить сообщение о загрузке:", err.message));
            }
        }
    }

    // --- ИЗМЕНЕНО: Функция теперь принимает ID сообщения для удаления ---
    async function processAndSendScheduleForGroup(chatId, dateObject, title, loadingMessageId) {
        try {
            const { data: scheduleData } = await axios.get(`${apiUrl}/api/bot/schedule/group-by-chat-id/${chatId}`, {
                headers: { 'x-bot-secret': botApiSecret }
            });
            const daySchedule = scheduleData.schedule.filter(item => {
                const lessonDate = new Date(item.lesson_date * 1000);
                return lessonDate.getFullYear() === dateObject.getFullYear() &&
                       lessonDate.getMonth() === dateObject.getMonth() &&
                       lessonDate.getDate() === dateObject.getDate();
            });
            const finalTitle = `${title} для группы ${scheduleData.groupName}`;
            const message = formatSchedule(daySchedule, finalTitle, scheduleData.role, dateObject);
            
            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });

        } catch (error) {
            const errorMessage = error.response?.data?.message || "Произошла ошибка.";
            console.error(`Ошибка при отправке для группы ${chatId}:`, errorMessage);
            if (error.response?.status === 404) {
                bot.sendMessage(chatId, `Эта группа не привязана к расписанию. Администратор должен использовать команду /bind_group.`);
            } else {
                bot.sendMessage(chatId, `Не удалось получить расписание для группы. Ошибка: ${errorMessage}`);
            }
        } finally {
            // Удаляем сообщение "Загружаю..." в любом случае
            if (loadingMessageId) {
                bot.deleteMessage(chatId, loadingMessageId).catch(err => console.error("Не удалось удалить сообщение о загрузке:", err.message));
            }
        }
    }

    // ... (cron jobs без изменений) ...

    // ... (callback_query handler без изменений) ...

    // ... (/start, /login, /bind_group, /help handlers без изменений) ...

    // --- ИЗМЕНЕНО: Обработчики команд теперь сохраняют ID сообщения "Загружаю..." ---
    bot.onText(/\/schedule_today/, async (msg) => {
        const chatId = msg.chat.id;
        const loadingMessage = await bot.sendMessage(chatId, "Загружаю расписание на сегодня...");
        
        if (msg.chat.type === 'private') {
            processAndSendScheduleForUser(chatId, new Date(), "Расписание на сегодня", loadingMessage.message_id);
        } else {
            processAndSendScheduleForGroup(chatId, new Date(), "Расписание на сегодня", loadingMessage.message_id);
        }
    });

    bot.onText(/\/schedule_tomorrow/, async (msg) => {
        const chatId = msg.chat.id;
        const loadingMessage = await bot.sendMessage(chatId, "Загружаю расписание на завтра...");
        
        const tomorrowDate = new Date();
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        
        if (msg.chat.type === 'private') {
            processAndSendScheduleForUser(chatId, tomorrowDate, "Расписание на завтра", loadingMessage.message_id);
        } else {
            processAndSendScheduleForGroup(chatId, tomorrowDate, "Расписание на завтра", loadingMessage.message_id);
        }
    });

    // ... (message handler для логина без изменений) ...

    // --- Полный код остальных функций для целостности ---

    cron.schedule('0 7 * * *', () => {
        const today = new Date();
        processAndSendSchedule(today, "Расписание на сегодня");
        processAndSendGroupSchedules(today, "Расписание на сегодня");
    }, { scheduled: true, timezone: "Asia/Tashkent" });
    console.log('Утренний планировщик настроен на 7:00 (индивидуальный и групповой).');

    cron.schedule('0 19 * * *', () => {
        const today = new Date();
        if (today.getDay() === 6) {
            console.log("Сегодня суббота, вечерняя рассылка на завтра (воскресенье) пропущена.");
            return;
        }
        const tomorrowDate = new Date();
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        processAndSendSchedule(tomorrowDate, "Расписание на завтра");
        processAndSendGroupSchedules(tomorrowDate, "Расписание на завтра");
    }, { scheduled: true, timezone: "Asia/Tashkent" });
    console.log('Вечерний планировщик настроен на 19:00 (индивидуальный и групповой).');

    bot.on('callback_query', (callbackQuery) => {
        const msg = callbackQuery.message;
        const data = callbackQuery.data;
        bot.answerCallbackQuery(callbackQuery.id);

        if (data === 'link_account') {
            if (msg.chat.type !== 'private') {
                return bot.sendMessage(msg.chat.id, "Привязать аккаунт можно только в личном чате с ботом. Пожалуйста, напишите мне в ЛС.");
            }
            userStates[msg.chat.id] = { state: 'awaiting_hemis_login' };
            bot.sendMessage(msg.chat.id, "Пожалуйста, введите ваш логин от системы HEMIS (обычно это ID студента):");
        }
        if (data === 'schedule_today') {
            bot.onText(/\/schedule_today/, async (msg) => {
                const chatId = msg.chat.id;
                const loadingMessage = await bot.sendMessage(chatId, "Загружаю расписание на сегодня...");
                
                if (msg.chat.type === 'private') {
                    processAndSendScheduleForUser(chatId, new Date(), "Расписание на сегодня", loadingMessage.message_id);
                } else {
                    processAndSendScheduleForGroup(chatId, new Date(), "Расписание на сегодня", loadingMessage.message_id);
                }
            });
        }
        if (data === 'schedule_tomorrow') {
            bot.onText(/\/schedule_tomorrow/, async (msg) => {
                const chatId = msg.chat.id;
                const loadingMessage = await bot.sendMessage(chatId, "Загружаю расписание на завтра...");
                
                const tomorrowDate = new Date();
                tomorrowDate.setDate(tomorrowDate.getDate() + 1);
                
                if (msg.chat.type === 'private') {
                    processAndSendScheduleForUser(chatId, tomorrowDate, "Расписание на завтра", loadingMessage.message_id);
                } else {
                    processAndSendScheduleForGroup(chatId, tomorrowDate, "Расписание на завтра", loadingMessage.message_id);
                }
            });
        }
    });

    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        if (msg.chat.type !== 'private') {
            return bot.sendMessage(chatId, "👋 Привет! Я бот для расписания HEMIS. Чтобы привязать свой аккаунт, напишите мне в личные сообщения. Администраторы могут привязать эту группу командой /bind_group.");
        }

        delete userStates[chatId];
        try {
            const response = await axios.get(`${apiUrl}/api/bot/schedule/${chatId}`, {
                headers: { 'x-bot-secret': botApiSecret }
            });
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
            if (error.response && error.response.status === 404) {
                const welcomeMessage = `<b>Добро пожаловать в HEMIS-Notify Bot!</b>\n\n📅 Я помогу вам всегда быть в курсе — расписание будет приходить автоматически.\n\n🔗 Чтобы начать, просто привяжите свой аккаунт.\n\n🔒 Ваш пароль надёжно защищён с помощью шифрования <b>AES-256</b>.`;
                bot.sendMessage(chatId, welcomeMessage, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔗 Привязать аккаунт HEMIS', callback_data: 'link_account' }]
                        ]
                    }
                });
            } else {
                console.error("Ошибка в /start:", error.message);
                bot.sendMessage(chatId, "Произошла ошибка. Попробуйте позже.");
            }
        }
    });

    bot.onText(/\/login/, (msg) => {
        const chatId = msg.chat.id;
        if (msg.chat.type !== 'private') {
            return bot.sendMessage(chatId, "Привязать или сменить аккаунт можно только в личном чате с ботом. Пожалуйста, напишите мне в ЛС.");
        }
        userStates[chatId] = { state: 'awaiting_hemis_login' };
        bot.sendMessage(chatId, "Пожалуйста, введите ваш новый логин от системы HEMIS:");
    });

    bot.onText(/\/bind_group (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const groupName = match[1].trim();

        if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
            return bot.sendMessage(chatId, "Эта команда работает только в группах.");
        }

        try {
            const chatMember = await bot.getChatMember(chatId, userId);
            if (!['creator', 'administrator'].includes(chatMember.status)) {
                return bot.sendMessage(chatId, "Эту команду может использовать только администратор группы.");
            }
        } catch (error) {
            console.error("Error checking chat member status:", error);
            return bot.sendMessage(chatId, "Не удалось проверить ваши права администратора. Попробуйте позже.");
        }

        bot.sendMessage(chatId, `Пытаюсь привязать группу "${groupName}" к этому чату...`);
        try {
            const response = await axios.post(`${apiUrl}/api/bot/bind-group`, {
                groupName,
                chatId: chatId.toString()
            }, { headers: { 'x-bot-secret': botApiSecret } });

            if (response.data.success) {
                bot.sendMessage(chatId, `✅ ${response.data.message}`);
            }
        } catch (error) {
            const status = error.response?.status;
            const message = error.response?.data?.message || "Произошла неизвестная ошибка.";
            bot.sendMessage(chatId, `❌ Ошибка привязки (${status}): ${message}`);
        }
    });

    bot.onText(/\/bind_group$/, (msg) => {
        const chatId = msg.chat.id;
        if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
            return bot.sendMessage(chatId, "Эта команда работает только в группах.");
        }
        bot.sendMessage(chatId, "Пожалуйста, укажите название группы после команды.\n<b>Пример:</b> <code>/bind_group 915-23 KII</code>", { parse_mode: 'HTML' });
    });

    bot.onText(/\/help/, (msg) => {
        const helpMessage = `ℹ️ <b>Помощь</b>

Этот бот автоматически отправляет ваше расписание из системы <b>HEMIS</b>.

⏰ <b>Автоматическая рассылка:</b>
🕖 <b>7:00</b> — расписание на сегодня
🌙 <b>19:00</b> — расписание на завтра

📚 <b>Для групповых чатов:</b>
Администратор может привязать чат к академической группе 

командой:
<code>/bind_group НАЗВАНИЕ_ГРУППЫ</code>

<b>Пример:</b>
<code>/bind_group 915-23 KII</code>

После привязки расписание будет автоматически приходить в группу.`;

bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'HTML' });
    });

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        if (msg.chat.type !== 'private') return;
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