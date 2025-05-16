const express = require('express');
const router = express.Router();
const Schedule = require('../models/Schedule');
const Subject = require('../models/Subject');
const { protect } = require('../middleware/authMiddleware');

// GET /api/schedule
router.get('/', protect, async (req, res) => {
    try {
        let scheduleEntries;
        if (req.user.role === 'student') {
            scheduleEntries = await Schedule.find({ group: req.user.group })
                .populate({
                    path: 'subjectId',
                    select: 'name teacherId',
                    populate: { path: 'teacherId', select: 'name' }
                })
                .sort({ dayOfWeek: 1, time: 1 });
        } else if (req.user.role === 'teacher') {
            // Найти все предметы, которые ведет преподаватель
            const teacherSubjects = await Subject.find({ teacherId: req.user._id }).select('_id');
            const teacherSubjectIds = teacherSubjects.map(s => s._id);
            scheduleEntries = await Schedule.find({ subjectId: { $in: teacherSubjectIds } })
                .populate({
                    path: 'subjectId',
                    select: 'name teacherId group', // Добавим группу, чтобы преподаватель видел для какой группы занятие
                    populate: { path: 'teacherId', select: 'name' }
                })
                .sort({ dayOfWeek: 1, time: 1 });
        } else {
            return res.status(403).json({ message: "Invalid role for this query" });
        }
        res.json(scheduleEntries);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// POST /api/schedule (для создания записей расписания - админ/деканат/преподаватель?)
// Пока не реализуем, можно добавлять через Compass

module.exports = router;
