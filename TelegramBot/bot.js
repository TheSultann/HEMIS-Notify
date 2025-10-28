// TelegramBot/bot.js

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');

// --- Конфигурация ---
const token = process.env.TELEGRAM_BOT_TOKEN;
const apiUrl = process.env.MINI_HEMIS_API_URL;
const botApiSecret = process.env.BOT_API_SECRET;

if (!token || !apiUrl || !botApiSecret) {
    console.error('Ошибка: одна или несколько переменных окружения не найдены (.env)!');
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
 * @returns {String} - Отформатированная строка.
 */
function formatSchedule(schedule) {
    if (!schedule || schedule.length === 0) {
        return "На сегодня занятий нет. Можно отдыхать! 🎉";
    }
    // Сортируем пары по времени начала
    schedule.sort((a, b) => a.time.localeCompare(b.time));

    let message = "<b>Расписание на сегодня:</b>\n\n";
    schedule.forEach(item => {
        message += `🕒 <b>${item.time}</b>\n`;
        message += `📚 ${item.subjectId.name}\n`;
        message += `👤 ${item.subjectId.teacherId.name}\n`;
        message += `--------------------\n`;
    });
    return message;
}

/**
 * Главная функция, которая выполняет рассылку расписания.
 */
async function sendDailySchedule() {
    console.log(`[${new Date().toLocaleString()}] Запуск ежедневной рассылки расписания...`);
    try {
        // 1. Получаем список всех chatId подписчиков с бэкенда
        const response = await axios.get(`${apiUrl}/api/bot/subscribers`, {
            headers: { 'x-bot-secret': botApiSecret }
        });
        const chatIds = response.data;

        if (chatIds.length === 0) {
            console.log("Подписчики не найдены. Рассылка пропущена.");
            return;
        }
        console.log(`Найдено подписчиков: ${chatIds.length}`);

        // 2. Для каждого подписчика получаем и отправляем расписание
        for (const chatId of chatIds) {
            try {
                const scheduleResponse = await axios.get(`${apiUrl}/api/bot/schedule/${chatId}`, {
                    headers: { 'x-bot-secret': botApiSecret }
                });
                const fullSchedule = scheduleResponse.data;

                // 3. Фильтруем расписание, оставляя только сегодняшние занятия
                const today = new Date().getDay() || 7; // 1 (Пн) - 7 (Вс)
                const todaySchedule = fullSchedule.filter(item => item.dayOfWeek === today);

                // 4. Форматируем и отправляем сообщение
                const message = formatSchedule(todaySchedule);
                await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
                console.log(`Расписание успешно отправлено пользователю ${chatId}`);

            } catch (error) {
                console.error(`Ошибка при обработке пользователя ${chatId}:`, error.response?.data?.message || error.message);
                // Можно отправить пользователю сообщение об ошибке, если нужно
                // await bot.sendMessage(chatId, "Не удалось получить ваше расписание на сегодня. Попробуйте проверить его на сайте.");
            }
        }
        console.log("Ежедневная рассылка завершена.");

    } catch (error) {
        console.error("Критическая ошибка при выполнении рассылки:", error.response?.data?.message || error.message);
    }
}


// --- Планировщик Cron ---
// Запускает функцию sendDailySchedule() каждый день в 7:00 утра.
// Формат: 'минута час * * день_недели'
cron.schedule('00 11 * * *', () => {
    sendDailySchedule();
}, {
    scheduled: true,
    timezone: "Asia/Tashkent" // Укажите ваш часовой пояс
});

console.log('Планировщик рассылки настроен на 7:00 AM (Asia/Tashkent).');


// --- Обработчики команд (логин и старт) ---
// Этот код остается без изменений с прошлого шага

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const response = "Добро пожаловать в Mini-HEMIS бот! \n\nЧтобы получать ежедневные уведомления с расписанием, привяжите ваш аккаунт командой /login";
    bot.sendMessage(chatId, response);
});

bot.onText(/\/login/, (msg) => {
    const chatId = msg.chat.id;
    userStates[chatId] = { state: 'awaiting_email' };
    bot.sendMessage(chatId, "Пожалуйста, введите ваш email от аккаунта Mini-HEMIS:");
});

// Команда для ручного теста рассылки
bot.onText(/\/testschedule/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Запускаю тестовую отправку расписания для вашего аккаунта...");
    // Эта команда полезна для отладки, она имитирует рассылку только для вас
    sendDailyScheduleForUser(chatId);
});

// Отдельная функция для тестовой отправки одному юзеру
async function sendDailyScheduleForUser(chatId) {
    try {
        const scheduleResponse = await axios.get(`${apiUrl}/api/bot/schedule/${chatId}`, {
            headers: { 'x-bot-secret': botApiSecret }
        });
        const fullSchedule = scheduleResponse.data;
        const today = new Date().getDay() || 7;
        const todaySchedule = fullSchedule.filter(item => item.dayOfWeek === today);
        const message = formatSchedule(todaySchedule);
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error(`Ошибка при тестовой отправке для ${chatId}:`, error.message);
        bot.sendMessage(chatId, "Не удалось получить расписание. Проверьте логи сервера.");
    }
}


bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (text.startsWith('/')) return;
    const currentState = userStates[chatId];
    if (!currentState) return;

    if (currentState.state === 'awaiting_email') {
        currentState.email = text;
        currentState.state = 'awaiting_password';
        bot.sendMessage(chatId, "Отлично. Теперь введите ваш пароль. \n\n⚠️ Ваше сообщение с паролем будет удалено сразу после отправки для безопасности.");
    } else if (currentState.state === 'awaiting_password') {
        const email = currentState.email;
        const password = text;
        delete userStates[chatId];
        bot.deleteMessage(chatId, msg.message_id).catch(err => console.log("Не удалось удалить сообщение."));

        try {
            const response = await axios.post(`${apiUrl}/api/bot/link-account`, { email, password, chatId: chatId.toString() }, { headers: { 'x-bot-secret': botApiSecret } });
            if (response.data.success) {
                bot.sendMessage(chatId, "✅ Аккаунт успешно привязан! Теперь вы будете получать уведомления.");
            }
        } catch (error) {
            const status = error.response?.status;
            const message = error.response?.data?.message || "Произошла ошибка.";
            if (status === 401) bot.sendMessage(chatId, "❌ Ошибка: неверный email или пароль. Попробуйте снова: /login");
            else if (status === 409) bot.sendMessage(chatId, `❌ Ошибка: ${message}`);
            else bot.sendMessage(chatId, `❌ Произошла ошибка на сервере (${status}). Попробуйте позже.`);
        }
    }
});