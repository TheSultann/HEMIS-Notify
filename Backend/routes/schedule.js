const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');

// Функция для авторизации в HEMIS API
async function loginToHemis(hemisLogin, hemisPassword, userId) {
    const endpoint = "/v1/auth/login";
    const url = `${process.env.HEMIS_API_BASE}${endpoint}`;
    if (!hemisLogin || !hemisPassword) {
        console.log('HEMIS login or password missing');
        return null;
    }
    const loginData = { login: hemisLogin, password: hemisPassword };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Origin': 'https://student.urdu.uz' },
            body: JSON.stringify(loginData)
        });
        console.log('HEMIS Login API Response Status:', response.status);
        const data = await response.json();
        if (!data.success || !data.data?.token) {
            console.log('Failed to get HEMIS token:', data);
            return null;
        }
        const token = data.data.token;
        console.log('New HEMIS token received.');
        await User.findByIdAndUpdate(userId, { hemisToken: token });
        console.log('HEMIS token saved for user:', userId);
        return token;
    } catch (error) {
        console.error('Login to HEMIS failed:', error);
        return null;
    }
}

// Получение текущего семестра студента
async function getCurrentSemester(hemisToken) {
    const endpoint = '/v1/account/me';
    const url = `${process.env.HEMIS_API_BASE}${endpoint}`;
    console.log('Attempting to fetch current semester...');

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${hemisToken}`, 'Accept': 'application/json', 'Origin': 'https://student.urdu.uz' }
        });

        console.log(`Account Info API Response Status:`, response.status);
        if (response.status !== 200) {
            return null;
        }

        const data = await response.json();
        
        // ИСПРАВЛЕНО: Убран лишний ключ 'student' из пути
        const semesterCode = data?.data?.semester?.code;

        if (semesterCode) {
            console.log(`Successfully fetched current semester code: ${semesterCode}`);
            return semesterCode;
        } else {
            console.error('Could not find semester code in user profile data:', data);
            return null;
        }
    } catch (error) {
        console.error('Failed to fetch user profile data:', error);
        return null;
    }
}


// Функция для получения расписания
async function getScheduleFromHemis(hemisToken, user, semesterCode) {
    const endpoint = `/v1/education/schedule?semester=${semesterCode}`;
    const url = `${process.env.HEMIS_API_BASE}${endpoint}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${hemisToken}`, 'Accept': 'application/json', 'Origin': 'https://student.urdu.uz' }
        });

        console.log(`Trying Schedule Endpoint: ${endpoint}, Response Status:`, response.status);
        const data = await response.json();

        if (response.status === 401) {
            return { error: 'unauthorized' };
        }
        if (!data.success || !data.data) {
            console.log(`Failed to get schedule from Endpoint:`, data);
            return null;
        }
        
        const scheduleData = data.data;
        if (scheduleData.length === 0) {
            console.log(`No schedule items found for semester ${semesterCode}. The data array is empty.`);
        }

        const uniqueScheduleItems = [];
        const seen = new Set();
        scheduleData.forEach(item => {
            const lessonDate = new Date(item.lesson_date * 1000);
            const dayOfWeek = lessonDate.getDay() || 7;
            const time = item.lessonPair?.start_time || 'Unknown';
            const key = `${dayOfWeek}-${time}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueScheduleItems.push({
                    dayOfWeek, time,
                    subjectId: {
                        name: item.subject?.name || 'Unknown Subject',
                        teacherId: { name: item.employee?.name || 'Unknown Teacher' },
                        group: user.role === 'student' ? user.group : item.group?.name || 'Unknown Group'
                    }
                });
            }
        });
        return uniqueScheduleItems;
    } catch (error) {
        console.error(`Failed to get schedule from Endpoint:`, error);
        return null;
    }
}

// GET /api/schedule
router.get('/', protect, async (req, res) => {
    try {
        let hemisToken = req.user.hemisToken;

        if (!hemisToken) {
            console.log('HEMIS token not found, authenticating...');
            hemisToken = await loginToHemis(req.user.hemisLogin, req.user.hemisPassword, req.user._id);
            if (!hemisToken) return res.status(401).json({ message: 'Failed to authenticate with HEMIS API.' });
        }

        let semesterCode = await getCurrentSemester(hemisToken);
        if (!semesterCode) {
            console.log('Could not get semester, re-authenticating to get a fresh token...');
            hemisToken = await loginToHemis(req.user.hemisLogin, req.user.hemisPassword, req.user._id);
            if (!hemisToken) return res.status(401).json({ message: 'Failed to re-authenticate with HEMIS API.' });
            
            semesterCode = await getCurrentSemester(hemisToken);
            if (!semesterCode) {
                return res.status(400).json({ message: 'Could not determine current semester from HEMIS API.' });
            }
        }

        let scheduleResult = await getScheduleFromHemis(hemisToken, req.user, semesterCode);

        if (scheduleResult?.error === 'unauthorized') {
            console.log('Token was invalid for schedule, re-authenticating one last time...');
            hemisToken = await loginToHemis(req.user.hemisLogin, req.user.hemisPassword, req.user._id);
            if (!hemisToken) return res.status(401).json({ message: 'Failed to re-authenticate with HEMIS API.' });

            scheduleResult = await getScheduleFromHemis(hemisToken, req.user, semesterCode);
        }

        if (scheduleResult === null || scheduleResult?.error) {
            return res.status(400).json({ message: 'Failed to fetch schedule from HEMIS API after all attempts.' });
        }

        res.json(scheduleResult);
    } catch (error) {
        console.error('Schedule fetch route error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

router.scheduleService = {
    loginToHemis,
    getCurrentSemester,
    getScheduleFromHemis
};


module.exports = router;