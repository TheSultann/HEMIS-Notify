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

// --- Хранилище состояний для диалога ---
const userStates = {};

// --- Функции-помощники ---

/**
 * Форматирует массив с расписанием в красивое сообщение.
 * @param {Array} schedule - Массив объектов расписания.
 * @param {String} title - Заголовок сообщения.
 * @param {String} role - Роль пользователя.
 * @param {Date} dateObject - Объект даты для отображения.
 * @returns {String} - Отформатированная строка.
 */
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
        if (item.subjectId.lessonType) {
            message += `🏷️ ${item.subjectId.lessonType}\n`;
        }
        if (role === 'teacher') {
            message += `👥 ${item.subjectId.groupName}\n`;
        } else {
            message += `👤 ${item.subjectId.teacherName}\n`;
        }
        message += `🚪 ${item.subjectId.auditoriumName}\n`;
        message += `--------------------\n`;
    });
    return message;
}

/**
 * Главная функция, которая запрашивает и рассылает расписание.
 * @param {Number} targetDay - День недели для рассылки (1=Пн, ..., 7=Вс).
 * @param {String} title - Заголовок для сообщения.
 * @param {Date} dateObject - Объект даты.
 */
async function processAndSendSchedule(targetDay, title, dateObject) {
    console.log(`[${new Date().toLocaleString()}] Запуск рассылки: "${title}"`);
    try {
        const response = await axios.get(`${apiUrl}/api/bot/subscribers`, {
            headers: { 'x-bot-secret': botApiSecret }
        });
        const subscribers = response.data;

        if (subscribers.length === 0) {
            console.log("Подписчики не найдены. Рассылка пропущена.");
            return;
        }
        console.log(`Найдено подписчиков: ${subscribers.length}`);

        for (const subscriber of subscribers) {
            try {
                const scheduleResponse = await axios.get(`${apiUrl}/api/bot/schedule/${subscriber.telegramChatId}`, {
                    headers: { 'x-bot-secret': botApiSecret }
                });
                const fullSchedule = scheduleResponse.data.schedule;
                const daySchedule = fullSchedule.filter(item => item.dayOfWeek === targetDay);
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

/**
 * Функция для отправки расписания одному пользователю по команде.
 * @param {String} chatId - ID чата пользователя.
 * @param {Number} targetDay - Целевой день недели.
 * @param {String} title - Заголовок сообщения.
 * @param {Date} dateObject - Объект даты.
 */
async function processAndSendScheduleForUser(chatId, targetDay, title, dateObject) {
    try {
        const scheduleResponse = await axios.get(`${apiUrl}/api/bot/schedule/${chatId}`, {
            headers: { 'x-bot-secret': botApiSecret }
        });
        const fullSchedule = scheduleResponse.data.schedule;
        const userRole = scheduleResponse.data.role;
        const daySchedule = fullSchedule.filter(item => item.dayOfWeek === targetDay);
        const message = formatSchedule(daySchedule, title, userRole, dateObject);
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error(`Ошибка при тестовой отправке для ${chatId}:`, error.message);
        bot.sendMessage(chatId, "Не удалось получить расписание. Проверьте логи сервера.");
    }
}

// --- Планировщики Cron ---
cron.schedule('0 11 * * *', () => {
    const today = new Date().getDay() || 7;
    const todayDate = new Date();
    processAndSendSchedule(today, "Расписание на сегодня", todayDate);
}, {
    scheduled: true,
    timezone: "Asia/Tashkent"
});
console.log('Утренний планировщик настроен на 11:00.');

cron.schedule('0 19 * * *', () => {
    const today = new Date().getDay() || 7;
    if (today === 6) {
        console.log("Сегодня суббота, вечерняя рассылка на завтра (воскресенье) пропущена.");
        return;
    }
    const tomorrow = (today % 7) + 1;
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    processAndSendSchedule(tomorrow, "Расписание на завтра", tomorrowDate);
}, {
    scheduled: true,
    timezone: "Asia/Tashkent"
});
console.log('Вечерний планировщик настроен на 19:00.');

// --- Обработчики команд ---
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const response = "Добро пожаловать в Mini-HEMIS бот! \n\nЯ буду присылать вам расписание утром (на сегодня) и вечером (на завтра).\n\nВоспользуйтесь меню команд или отправьте /help, чтобы увидеть все возможности.";
    bot.sendMessage(chatId, response);
});

bot.onText(/\/login/, (msg) => {
    const chatId = msg.chat.id;
    userStates[chatId] = { state: 'awaiting_hemis_login' };
    bot.sendMessage(chatId, "Пожалуйста, введите ваш логин от системы HEMIS (обычно это ID студента):");
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `<b>Доступные команды:</b>

/start - Перезапустить бота
/login - Привязать ваш аккаунт HEMIS
/schedule_today - Показать расписание на сегодня
/schedule_tomorrow - Показать расписание на завтра
/help - Показать это сообщение`;

    bot.sendMessage(chatId, helpMessage, { parse_mode: 'HTML' });
});

bot.onText(/\/schedule_today/, (msg) => {
    bot.sendMessage(msg.chat.id, "Загружаю расписание на сегодня...");
    const today = new Date().getDay() || 7;
    const todayDate = new Date();
    processAndSendScheduleForUser(msg.chat.id, today, "Расписание на сегодня", todayDate);
});

bot.onText(/\/schedule_tomorrow/, (msg) => {
    bot.sendMessage(msg.chat.id, "Загружаю расписание на завтра...");
    const today = new Date().getDay() || 7;
    const tomorrow = (today % 7) + 1;
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    processAndSendScheduleForUser(msg.chat.id, tomorrow, "Расписание на завтра", tomorrowDate);
});

// --- Обработчик сообщений для логина ---
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
    }
    else if (currentState.state === 'awaiting_hemis_password') {
        const hemisLogin = currentState.hemisLogin;
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
                bot.sendMessage(chatId, `✅ ${response.data.message}`);
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
});}
module.exports = { startBot };