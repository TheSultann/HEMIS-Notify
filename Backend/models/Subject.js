const mongoose = require('mongoose');

const MaterialSchema = new mongoose.Schema({
    title: { type: String, required: true },
    fileUrl: { type: String, required: true }, // Для простоты это будет URL, не загрузка файла на сервер
    uploadedAt: { type: Date, default: Date.now }
});

const SubjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    group: { type: String, required: true }, // Группа, для которой предназначен предмет
    materials: [MaterialSchema]
}, { timestamps: true });

module.exports = mongoose.model('Subject', SubjectSchema);
