const mongoose = require('mongoose');

const GroupSchema = new mongoose.Schema({
    // Название академической группы из HEMIS
    groupName: { type: String, required: true, unique: true },
    // ID чата группы в Telegram
    telegramChatId: { type: String, required: true, unique: true },
    language: { type: String, enum: ['ru-RU', 'uz-UZ'], default: 'uz-UZ' },
    // ID последнего планового сообщения с расписанием, чтобы заменять его следующим
    lastScheduleMessageId: { type: Number, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Group', GroupSchema);
