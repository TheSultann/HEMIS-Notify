const express = require('express');
const router = express.Router();
const Subject = require('../models/Subject');
const Grade = require('../models/Grade');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/authMiddleware');

// GET /api/subjects (для всех аутентифицированных)
router.get('/', protect, async (req, res) => {
    try {
        let subjects;
        if (req.user.role === 'student') {
            subjects = await Subject.find({ group: req.user.group }).populate('teacherId', 'name email');
        } else if (req.user.role === 'teacher') {
            subjects = await Subject.find({ teacherId: req.user._id }).populate('teacherId', 'name email');
        } else {
            return res.status(403).json({ message: "Invalid role for this query" });
        }
        res.json(subjects);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// GET /api/subjects/:id
router.get('/:id', protect, async (req, res) => {
    try {
        const subject = await Subject.findById(req.params.id).populate('teacherId', 'name');
        if (!subject) {
            return res.status(404).json({ message: 'Subject not found' });
        }
        // Доп. проверка: студент может видеть только предметы своей группы, преподаватель - свои
        if (req.user.role === 'student' && subject.group !== req.user.group) {
            return res.status(403).json({ message: 'Not authorized to view this subject' });
        }
        if (req.user.role === 'teacher' && subject.teacherId._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized to view this subject' });
        }
        res.json(subject);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});


// POST /api/subjects (создание предмета, только для админа или будущей роли "деканат")
// Для простоты, пока преподаватели не могут создавать предметы, только админ через Compass/руками
// Или можно разрешить преподавателям создавать предметы для себя.

// POST /api/subjects/:id/materials (только для teacher)
router.post('/:id/materials', protect, authorize('teacher'), async (req, res) => {
    const { title, fileUrl } = req.body;
    if (!title || !fileUrl) {
        return res.status(400).json({ message: 'Title and File URL are required' });
    }
    try {
        const subject = await Subject.findById(req.params.id);
        if (!subject) return res.status(404).json({ message: 'Subject not found' });
        if (subject.teacherId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized to add materials to this subject' });
        }
        subject.materials.push({ title, fileUrl });
        await subject.save();
        res.status(201).json(subject.materials[subject.materials.length-1]);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// POST /api/subjects/:id/grades (только для teacher)
router.post('/:id/grades', protect, authorize('teacher'), async (req, res) => {
    const { studentId, grade } = req.body; // grade - число
    const subjectId = req.params.id;

    if (!studentId || grade === undefined) {
        return res.status(400).json({ message: 'Student ID and grade are required' });
    }
    if (typeof grade !== 'number' || grade < 0 || grade > 100) { // Пример шкалы 0-100
        return res.status(400).json({ message: 'Grade must be a number between 0 and 100' });
    }

    try {
        const subject = await Subject.findById(subjectId);
        if (!subject) return res.status(404).json({ message: 'Subject not found' });
        if (subject.teacherId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized to grade for this subject' });
        }
        const student = await User.findById(studentId);
        if (!student || student.role !== 'student' || student.group !== subject.group) {
            return res.status(404).json({ message: 'Student not found in this subject group' });
        }

        // Обновляем или создаем оценку
        const existingGrade = await Grade.findOne({ studentId, subjectId });
        if (existingGrade) {
            existingGrade.grade = grade;
            existingGrade.date = Date.now();
            await existingGrade.save();
            res.json(existingGrade);
        } else {
            const newGrade = new Grade({ studentId, subjectId, grade });
            await newGrade.save();
            res.status(201).json(newGrade);
        }
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;
