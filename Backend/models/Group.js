const mongoose = require('mongoose');

const GroupSchema = new mongoose.Schema({
    // Название академической группы из HEMIS
    groupName: { type: String, required: true, unique: true },
    // ID чата группы в Telegram
    telegramChatId: { type: String, required: true, unique: true },
}, { timestamps: true });

module.exports = mongoose.model('Group', GroupSchema);