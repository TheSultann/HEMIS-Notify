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
            console.log('HEMIS Login failed:', loginData);
            return null;
        }
        const token = loginData.data.token;

        const profileResponse = await fetch(`${process.env.HEMIS_API_BASE}/v1/account/me`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'Origin': 'https://student.urdu.uz' }
        });
        const profileData = await profileResponse.json();
        if (!profileData.success) {
            console.log('HEMIS Get Profile failed:', profileData);
            return null;
        }
        
        // ИЗМЕНЕНО: Безопасное получение имени группы с помощью optional chaining (?.),
        // чтобы избежать ошибки, если у пользователя нет информации о группе.
        return {
            token,
            profileData: {
                fullName: profileData.data?.full_name,
                isStudent: !!profileData.data?.student_id_number,
                groupName: profileData.data?.group?.name || null // Если группы нет, будет null
            }
        };
    } catch (error) {
        console.error('performHemisLogin error:', error);
        return null;
    }
}

async function getCurrentSemester(hemisToken) {
    const endpoint = '/v1/account/me';
    const url = `${process.env.HEMIS_API_BASE}${endpoint}`;
    
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

        if (response.status === 401) return { error: 'unauthorized' };
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

router.scheduleService = {
    performHemisLogin,
    getCurrentSemester,
    getScheduleFromHemis
};

module.exports = router;