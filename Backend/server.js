// Backend/server.js

const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');
const botRoutes = require('./routes/bot');  

dotenv.config();
connectDB();

const app = express();

app.use(cors());
app.use(express.json());

// УДАЛЯЕМ ВСЕ ЛИШНИЕ РОУТЫ
// app.use('/api/auth', require('./routes/auth'));
// app.use('/api/users', require('./routes/users'));
// ... и так далее

// ОСТАВЛЯЕМ ТОЛЬКО НУЖНЫЕ
app.use('/api/schedule', require('./routes/schedule'));
app.use('/api/bot', botRoutes);

app.get('/', (req, res) => {
    res.send('Mini-Hemis API is running...');
});

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;