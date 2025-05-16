const mongoose = require('mongoose');

const GradeSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    grade: { type: Number, required: true, min: 0, max: 100 }, // или другая шкала
    date: { type: Date, default: Date.now }
}, { timestamps: true });

// Уникальный индекс, чтобы студент не мог иметь две оценки по одному предмету
// (можно заменить на логику обновления существующей оценки)
GradeSchema.index({ studentId: 1, subjectId: 1 }, { unique: true });


module.exports = mongoose.model('Grade', GradeSchema);
