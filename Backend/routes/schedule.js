// Backend/routes/schedule.js

const express = require('express');
const router = express.Router();

async function performHemisLogin(hemisLogin, hemisPassword) {
    try {
        const loginResponse = await fetch(`${process.env.HEMIS_API_BASE}/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Origin': 'https://student.urdu.uz' },
            body: JSON.stringify({ login: hemisLogin, password: hemisPassword })
        });
        const loginData = await loginResponse.json();
        if (!loginData.success || !loginData.data?.token) {
            // Не логируем 401 (неверный пароль) — это ожидаемо для студентов, сменивших пароль
            if (loginData.code !== 401) {
                console.log('HEMIS Login failed:', loginData);
            }
            return null;
        }
        const token = loginData.data.token;

        const profileResponse = await fetch(`${process.env.HEMIS_API_BASE}/v1/account/me?l=ru-RU`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'Origin': 'https://student.urdu.uz' }
        });
        const profileData = await profileResponse.json();
        if (!profileData.success) {
            console.log('HEMIS Get Profile failed:', profileData);
            return null;
        }

        return {
            token,
            profileData: {
                fullName: profileData.data?.full_name,
                isStudent: !!profileData.data?.student_id_number,
                groupName: profileData.data?.group?.name || null
            }
        };
    } catch (error) {
        console.error('performHemisLogin error:', error);
        return null;
    }
}

async function getCurrentSemester(hemisToken, language = 'ru-RU') {
    const endpoint = '/v1/account/me';
    const langParam = language ? `?l=${language}` : '';
    const url = `${process.env.HEMIS_API_BASE}${endpoint}${langParam}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${hemisToken}`, 'Accept': 'application/json', 'Origin': 'https://student.urdu.uz' }
        });
        if (response.status !== 200) return null;
        const data = await response.json();
        const semesterCode = data?.data?.semester?.code;
        if (semesterCode) return semesterCode;
        return null;
    } catch (error) {
        console.error('Failed to fetch user profile data:', error);
        return null;
    }
}

async function getScheduleFromHemis(hemisToken, user, semesterCode, language = 'ru-RU') {
    const langParam = language ? `&l=${language}` : '';
    const endpoint = `/v1/education/schedule?semester=${semesterCode}${langParam}`;
    const url = `${process.env.HEMIS_API_BASE}${endpoint}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${hemisToken}`, 'Accept': 'application/json', 'Origin': 'https://student.urdu.uz' }
        });

        if (response.status === 401) return { error: 'unauthorized' };
        const data = await response.json();
        if (!data.success || !data.data) return null;

        const scheduleData = data.data.map(item => ({
            lesson_date: item.lesson_date,
            time: item.lessonPair?.start_time || 'Unknown',
            subjectId: {
                name: item.subject?.name || 'Unknown Subject',
                teacherName: item.employee?.name || 'N/A',
                groupName: item.group?.name || 'N/A',
                auditoriumName: item.auditorium?.name || 'N/A',
                lessonType: item.trainingType?.name || ''
            }
        }));

        return scheduleData;
    } catch (error) {
        console.error(`Failed to get schedule from Endpoint:`, error);
        return null;
    }
}

async function getAttendanceFromHemis(hemisToken, semesterCode, language = 'ru-RU') {
    const langParam = language ? `&l=${language}` : '';
    const endpoint = `/v1/education/attendance?semester=${semesterCode}${langParam}`;
    const url = `${process.env.HEMIS_API_BASE}${endpoint}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${hemisToken}`, 'Accept': 'application/json', 'Origin': 'https://student.urdu.uz' }
        });

        if (response.status === 401) return { error: 'unauthorized' };
        const data = await response.json();

        if (!data.success || !data.data) return null;

        const subjectsMap = {};
        let totalHours = 0;
        let justifiedHours = 0;
        let unjustifiedHours = 0;

        data.data.forEach(item => {
            const hours = (item.absent_on || 0) + (item.absent_off || 0);

            if (hours > 0) {
                totalHours += hours;
                const isJustified = item.explicable === true;

                if (isJustified) justifiedHours += hours;
                else unjustifiedHours += hours;

                const subjectName = item.subject?.name || 'Неизвестный предмет';

                if (!subjectsMap[subjectName]) {
                    subjectsMap[subjectName] = {
                        name: subjectName,
                        totalSubjectHours: 0,
                        details: []
                    };
                }

                subjectsMap[subjectName].totalSubjectHours += hours;
                subjectsMap[subjectName].details.push({
                    date: item.lesson_date, // Timestamp
                    time: item.lessonPair?.start_time || '',
                    hours: hours,
                    isJustified: isJustified
                });
            }
        });

        // Превращаем объект в массив и сортируем детали по дате
        const subjects = Object.values(subjectsMap).map(sub => {
            sub.details.sort((a, b) => a.date - b.date); // Сортировка дат от старых к новым
            return sub;
        });

        return {
            totalHours,
            justifiedHours,
            unjustifiedHours,
            subjects
        };

    } catch (error) {
        console.error('Failed to get attendance:', error);
        return null;
    }
}


router.scheduleService = {
    performHemisLogin,
    getCurrentSemester,
    getScheduleFromHemis,
    getAttendanceFromHemis
};
module.exports = router;
