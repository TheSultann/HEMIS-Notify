const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, authorize } = require('../middleware/authMiddleware');

// Функция для авторизации в HEMIS API
async function loginToHemis(hemisLogin, hemisPassword, userId) {
    const endpoint = "/v1/auth/login";
    const url = `${process.env.HEMIS_API_BASE}${endpoint}`;

    if (!hemisLogin || !hemisPassword) {
        return null;
    }

    const loginData = {
        login: hemisLogin,
        password: hemisPassword
    };

    try {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Задержка для лимита

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Origin': 'https://student.urdu.uz'
            },
            body: JSON.stringify(loginData)
        });

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error('Expected JSON, but received non-JSON response');
        }

        const data = await response.json();

        if (!data.success || !data.data?.token) {
            return null;
        }

        const token = data.data.token;

        const updatedUser = await User.findByIdAndUpdate(userId, { hemisToken: token }, { new: true });
        if (!updatedUser) {
            console.error('Failed to update user with HEMIS token for userId:', userId);
            return null;
        }
        console.log('HEMIS token saved for user:', userId);

        return token;
    } catch (error) {
        console.error('HEMIS Login Failed:', error);
        return null;
    }
}

// Функция для получения итоговых оценок (для допуска) из /v1/education/subject-list
async function getSubjectListFromHemis(hemisToken) {
    const semesterCode = '14'; // 2-й курс, 4-й семестр
    const endpoint = `/v1/education/subject-list?semester=${semesterCode}`;
    const url = `${process.env.HEMIS_API_BASE}${endpoint}`;

    try {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Задержка для лимита

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${hemisToken}`,
                'Accept': 'application/json',
                'Origin': 'https://student.urdu.uz'
            }
        });

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error('Expected JSON, but received non-JSON response');
        }

        const data = await response.json();

        if (!data.success || !data.data) {
            return [];
        }

        // Фильтрация по текущему семестру (_semester)
        const subjectListGrades = data.data
            .filter(item => item._semester === semesterCode)
            .map(item => ({
                type: 'semester', // Тип: итоговые оценки за семестр
                subjectId: { name: item.curriculumSubject?.subject?.name || 'Unknown Subject' },
                grade: item.overallScore?.grade || item.overallScore?.label || 'Not available',
                semester: item._semester,
                date: item.lesson_date ? new Date(item.lesson_date * 1000).toLocaleDateString() : 'N/A',
                details: item.gradesByExam?.map(exam => ({
                    type: exam.examType.name,
                    grade: exam.grade,
                    max_ball: exam.max_ball,
                    label: exam.label
                })) || []
            }));

        return subjectListGrades;
    } catch (error) {
        console.error('Subject List API - Fetch Failed:', error);
        return [];
    }
}

// Функция для получения экзаменационных оценок из /v1/data/student-performance-list
async function getStudentPerformanceFromHemis(hemisToken) {
    const semesterCode = '14'; // 2-й курс, 4-й семестр
    const endpoint = `/v1/data/student-performance-list?semester=${semesterCode}`;
    const url = `${process.env.HEMIS_API_BASE}${endpoint}`;

    try {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Задержка для лимита

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${hemisToken}`,
                'Accept': 'application/json',
                'Origin': 'https://student.urdu.uz'
            }
        });

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error('Expected JSON, but received non-JSON response');
        }

        const data = await response.json();

        if (!data.success || !data.data) {
            return [];
        }

        // Фильтрация по текущему семестру (_semester)
        const performanceGrades = data.data
            .filter(item => item._semester === semesterCode)
            .map(item => ({
                type: 'exam', // Тип: экзаменационные оценки
                subjectId: { name: item.subject?.name || 'Unknown Subject' },
                grade: item.grade || 'Not available',
                semester: item._semester,
                date: item.exam_date ? new Date(item.exam_date * 1000).toLocaleDateString() : 'N/A'
            }));

        return performanceGrades;
    } catch (error) {
        console.error('Student Performance API - Fetch Failed:', error);
        return [];
    }
}

// GET /api/grades (для студента - его оценки из HEMIS)
router.get('/', protect, authorize('student'), async (req, res) => {
    try {
        let hemisToken = req.user.hemisToken;

        if (!hemisToken) {
            const user = await User.findById(req.user._id);
            if (!user || !user.hemisLogin || !user.hemisPassword) {
                return res.status(401).json({ message: 'HEMIS credentials not found. Please re-register.' });
            }

            hemisToken = await loginToHemis(user.hemisLogin, user.hemisPassword, user._id);
            if (!hemisToken) {
                return res.status(401).json({ message: 'Failed to re-authenticate with HEMIS API.' });
            }
        }

        // Получаем итоговые оценки (для допуска)
        const subjectListGrades = await getSubjectListFromHemis(hemisToken);
        if (!subjectListGrades || subjectListGrades.length === 0) {
            const user = await User.findById(req.user._id);
            if (!user || !user.hemisLogin || !user.hemisPassword) {
                return res.status(401).json({ message: 'HEMIS credentials not found. Please re-register.' });
            }

            hemisToken = await loginToHemis(user.hemisLogin, user.hemisPassword, user._id);
            if (!hemisToken) {
                return res.status(401).json({ message: 'Failed to re-authenticate with HEMIS API.' });
            }

            const retrySubjectListGrades = await getSubjectListFromHemis(hemisToken);
        }

        // Получаем экзаменационные оценки
        const performanceGrades = await getStudentPerformanceFromHemis(hemisToken);
        if (!performanceGrades || performanceGrades.length === 0) {
            const user = await User.findById(req.user._id);
            if (!user || !user.hemisLogin || !user.hemisPassword) {
                return res.status(401).json({ message: 'HEMIS credentials not found. Please re-register.' });
            }

            hemisToken = await loginToHemis(user.hemisLogin, user.hemisPassword, user._id);
            if (!hemisToken) {
                return res.status(401).json({ message: 'Failed to re-authenticate with HEMIS API.' });
            }

            const retryPerformanceGrades = await getStudentPerformanceFromHemis(hemisToken);
        }

        // Объединяем данные
        const grades = [...(subjectListGrades || []), ...(performanceGrades || [])];

        res.json(grades);
    } catch (error) {
        console.error('Grades Fetch Error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;
