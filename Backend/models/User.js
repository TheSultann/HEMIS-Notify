// Backend/models/User.js

const mongoose = require('mongoose');

// Normalize legacy/short language codes to the enum values used across the app
const normalizeLanguage = (lang) => {
    if (!lang) return lang; // keep null/undefined
    if (lang === 'ru') return 'ru-RU';
    if (lang === 'uz') return 'uz-UZ';
    return ['ru-RU', 'uz-UZ'].includes(lang) ? lang : 'ru-RU';
};

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
    telegramChatId: { type: String, unique: true, sparse: true },
    lastKnownAbsentHours: { type: Number, default: -1 },
    lastSemesterCode: { type: String, default: null }, // Семестр, к которому относится lastKnownAbsentHours
    language: { type: String, enum: ['ru-RU', 'uz-UZ'], default: null },

    // --- НОВЫЕ ПОЛЯ ДЛЯ СТАТИСТИКИ ---
    isBlocked: { type: Boolean, default: false }, // Заблокировал ли юзер бота
    lastActiveAt: { type: Date, default: Date.now }, // Дата последнего нажатия кнопок
    // createdAt создается автоматически благодаря { timestamps: true }

}, { timestamps: true });

// Fix invalid/legacy language codes before validation (e.g., 'ru' -> 'ru-RU')
UserSchema.pre('validate', function (next) {
    this.language = normalizeLanguage(this.language);
    next();
});

module.exports = mongoose.model('User', UserSchema);
