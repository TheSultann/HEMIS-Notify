const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');

// Загрузка переменных окружения
dotenv.config();

// Подключение к БД
connectDB();

const app = express();

// Middleware
app.use(cors()); // Разрешить CORS для всех источников (для разработки)
app.use(express.json()); // Для парсинга application/json

// Роуты
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/subjects', require('./routes/subjects'));
app.use('/api/grades', require('./routes/grades'));
app.use('/api/schedule', require('./routes/schedule'));


app.get('/', (req, res) => {
    res.send('Mini-Hemis API is running...');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
