// index.js (в корне проекта)

// Загружаем переменные окружения из .env файлов
require('dotenv').config({ path: './Backend/.env' });
require('dotenv').config({ path: './TelegramBot/.env' });

const axios = require('axios');
const cron = require('node-cron');
const app = require('./Backend/server'); // Импортируем настроенный Express-сервер
const { startBot } = require('./TelegramBot/bot'); // Импортируем функцию запуска бота

const PORT = process.env.PORT || 5000;

// --- Логика для Render ---

// 1. Корневой маршрут для проверки работоспособности (требование Render)
app.get('/', (req, res) => {
    res.send('Mini-HEMIS API & Bot Service is running!');
});

// 2. Фоновая "самоподдержка" для предотвращения засыпания
cron.schedule('*/10 * * * *', () => { // Запускается каждые 14 минут
    const selfUrl = process.env.RENDER_EXTERNAL_URL;
    if (selfUrl) {
        console.log('Pinging self to prevent sleep...');
        axios.get(selfUrl)
            .then(response => console.log(`Ping successful. Status: ${response.status}`))
            .catch(error => console.error(`Ping failed: ${error.message}`));
    }
});

// --- Запуск всего приложения ---
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    
    // После успешного запуска сервера, запускаем логику бота
    startBot();
});