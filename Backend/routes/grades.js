const express = require('express');
const router = express.Router();
const Grade = require('../models/Grade');
const { protect, authorize } = require('../middleware/authMiddleware');

// GET /api/grades (для студента - его оценки)
router.get('/', protect, authorize('student'), async (req, res) => {
    try {
        const grades = await Grade.find({ studentId: req.user._id })
            .populate('subjectId', 'name'); // Показываем название предмета
        res.json(grades);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Преподаватель может видеть оценки студентов по своим предметам через /api/subjects/:id/students_with_grades (нужно добавить)
// Или здесь добавить эндпоинт для преподавателя с фильтрацией по subjectId

module.exports = router;
