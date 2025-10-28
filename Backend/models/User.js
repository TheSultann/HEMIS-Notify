// Backend/models/User.js

const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    // Логин от HEMIS - уникальный идентификатор
    hemisLogin: { type: String, required: true, unique: true },
    // Пароль от HEMIS теперь хранится напрямую
    hemisPassword: { type: String, required: true },
    
    // Данные из профиля HEMIS
    fullName: { type: String },
    role: { type: String, enum: ['student', 'teacher'], default: 'student' },
    group: { type: String },

    // Технические поля
    hemisToken: { type: String },
    telegramChatId: { type: String, unique: true, sparse: true }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);