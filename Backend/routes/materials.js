const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, authorize } = require('../middleware/authMiddleware');

// Функция для авторизации в HEMIS API
async function loginToHemis(hemisLogin, hemisPassword, userId) {
    const endpoint = "/v1/auth/login";
    const url = `${process.env.HEMIS_API_BASE}${endpoint}`;

    if (!hemisLogin || !hemisPassword) {
        console.log('HEMIS Login: Credentials missing');
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

        console.log('HEMIS API Login Attempt - Status:', response.status);
        console.log('HEMIS API Login Response Headers:', [...response.headers.entries()]);

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.log('HEMIS API Login Response (non-JSON):', text);
            throw new Error('Expected JSON, but received non-JSON response');
        }

        const data = await response.json();
        console.log('HEMIS API Login Response Data:', JSON.stringify(data, null, 2));

        if (!data.success || !data.data?.token) {
            console.log('HEMIS Token Retrieval Failed:', data);
            return null;
        }

        const token = data.data.token;
        console.log('New HEMIS Token Received:', token);

        const updatedUser = await User.findByIdAndUpdate(userId, { hemisToken: token }, { new: true });
        if (!updatedUser) {
            console.error('Failed to update user with HEMIS token for userId:', userId);
            return null;
        }
        console.log('HEMIS Token Saved for User:', userId, 'Token:', token);

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
        console.log('Attempting to fetch Subject List from:', url);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Задержка для лимита

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${hemisToken}`,
                'Accept': 'application/json',
                'Origin': 'https://student.urdu.uz'
            }
        });

        console.log(`Subject List API - Response Status: ${response.status}`);
        console.log('Subject List API - Response Headers:', [...response.headers.entries()]);

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.log(`Subject List API - Response (non-JSON): ${text}`);
            throw new Error('Expected JSON, but received non-JSON response');
        }

        const data = await response.json();
        console.log('Subject List API - Full Data Received:', JSON.stringify(data, null, 2));

        if (!data.success || !data.data) {
            console.log('Subject List API - No Data or Success:', JSON.stringify(data, null, 2));
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

        console.log('Subject List API - Filtered Grades:', JSON.stringify(subjectListGrades, null, 2));
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
        console.log('Attempting to fetch Student Performance from:', url);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Задержка для лимита

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${hemisToken}`,
                'Accept': 'application/json',
                'Origin': 'https://student.urdu.uz'
            }
        });

        console.log(`Student Performance API - Response Status: ${response.status}`);
        console.log('Student Performance API - Response Headers:', [...response.headers.entries()]);

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.log(`Student Performance API - Response (non-JSON): ${text}`);
            throw new Error('Expected JSON, but received non-JSON response');
        }

        const data = await response.json();
        console.log('Student Performance API - Full Data Received:', JSON.stringify(data, null, 2));

        if (!data.success || !data.data) {
            console.log('Student Performance API - No Data or Success:', JSON.stringify(data, null, 2));
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

        console.log('Student Performance API - Filtered Grades:', JSON.stringify(performanceGrades, null, 2));
        return performanceGrades;
    } catch (error) {
        console.error('Student Performance API - Fetch Failed:', error);
        return [];
    }
}

// GET /api/grades (для студента - его оценки из HEMIS)
router.get('/', protect, authorize('student'), async (req, res) => {
    try {
        console.log('Received GET request to /api/grades');
        let hemisToken = req.user.hemisToken;
        console.log('User Data from Middleware:', JSON.stringify(req.user, null, 2));

        if (!hemisToken) {
            console.log('HEMIS Token Not Found, Attempting Re-authentication...');
            const user = await User.findById(req.user._id);
            if (!user || !user.hemisLogin || !user.hemisPassword) {
                console.log('HEMIS credentials missing for user:', req.user._id);
                return res.status(401).json({ message: 'HEMIS credentials not found. Please re-register.' });
            }

            hemisToken = await loginToHemis(user.hemisLogin, user.hemisPassword, user._id);
            if (!hemisToken) {
                console.log('Re-authentication failed');
                return res.status(401).json({ message: 'Failed to re-authenticate with HEMIS API.' });
            }
        }

        // Получаем итоговые оценки (для допуска)
        console.log('Fetching Subject List Grades...');
        const subjectListGrades = await getSubjectListFromHemis(hemisToken);
        if (!subjectListGrades || subjectListGrades.length === 0) {
            console.log('Subject List Grades Empty or Failed, Retrying Authentication...');
            const user = await User.findById(req.user._id);
            if (!user || !user.hemisLogin || !user.hemisPassword) {
                console.log('HEMIS credentials missing for user:', req.user._id);
                return res.status(401).json({ message: 'HEMIS credentials not found. Please re-register.' });
            }

            hemisToken = await loginToHemis(user.hemisLogin, user.hemisPassword, user._id);
            if (!hemisToken) {
                console.log('Re-authentication failed');
                return res.status(401).json({ message: 'Failed to re-authenticate with HEMIS API.' });
            }

            const retrySubjectListGrades = await getSubjectListFromHemis(hemisToken);
            if (!retrySubjectListGrades || retrySubjectListGrades.length === 0) {
                console.log('Failed to fetch subject list after re-authentication.');
            }
        }

        // Получаем экзаменационные оценки
        console.log('Fetching Student Performance Grades...');
        const performanceGrades = await getStudentPerformanceFromHemis(hemisToken);
        if (!performanceGrades || performanceGrades.length === 0) {
            console.log('Student Performance Grades Empty or Failed, Retrying Authentication...');
            const user = await User.findById(req.user._id);
            if (!user || !user.hemisLogin || !user.hemisPassword) {
                console.log('HEMIS credentials missing for user:', req.user._id);
                return res.status(401).json({ message: 'HEMIS credentials not found. Please re-register.' });
            }

            hemisToken = await loginToHemis(user.hemisLogin, user.hemisPassword, user._id);
            if (!hemisToken) {
                console.log('Re-authentication failed');
                return res.status(401).json({ message: 'Failed to re-authenticate with HEMIS API.' });
            }

            const retryPerformanceGrades = await getStudentPerformanceFromHemis(hemisToken);
            if (!retryPerformanceGrades || retryPerformanceGrades.length === 0) {
                console.log('Failed to fetch student performance after re-authentication.');
            }
        }

        // Объединяем данные
        const grades = [...(subjectListGrades || []), ...(performanceGrades || [])];
        console.log('Final Combined Grades:', JSON.stringify(grades, null, 2));

        res.json(grades);
    } catch (error) {
        console.error('Grades Fetch Error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;