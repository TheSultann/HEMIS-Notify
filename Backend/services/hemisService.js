const DEFAULT_HEADERS = {
    Accept: 'application/json',
    Origin: 'https://student.urdu.uz'
};
const HEMIS_RATE_LIMIT_ERROR = 'rate_limited';
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;

function buildHeaders(hemisToken) {
    if (!hemisToken) {
        return DEFAULT_HEADERS;
    }

    return {
        ...DEFAULT_HEADERS,
        Authorization: `Bearer ${hemisToken}`
    };
}

function getRateLimitCooldownMs() {
    const configuredValue = Number(process.env.HEMIS_RATE_LIMIT_COOLDOWN_MS);
    return Number.isFinite(configuredValue) && configuredValue > 0
        ? configuredValue
        : DEFAULT_RATE_LIMIT_COOLDOWN_MS;
}

function isRateLimitedAuthResult(authData) {
    return authData?.error === HEMIS_RATE_LIMIT_ERROR;
}

async function performHemisLogin(hemisLogin, hemisPassword) {
    try {
        const loginResponse = await fetch(`${process.env.HEMIS_API_BASE}/v1/auth/login`, {
            method: 'POST',
            headers: {
                ...DEFAULT_HEADERS,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ login: hemisLogin, password: hemisPassword })
        });
        const loginData = await loginResponse.json();
        if (!loginData.success || !loginData.data?.token) {
            if (loginData.code === 429 || loginData.data?.error === 'CAPTCHA_REQUIRED') {
                console.log('HEMIS Login rate-limited:', loginData);
                return {
                    error: HEMIS_RATE_LIMIT_ERROR,
                    retryAfterMs: getRateLimitCooldownMs(),
                    message: loginData.error || 'HEMIS temporarily requires captcha'
                };
            }

            if (loginData.code !== 401) {
                console.log('HEMIS Login failed:', loginData);
            }
            return null;
        }

        const token = loginData.data.token;
        const profileResponse = await fetch(`${process.env.HEMIS_API_BASE}/v1/account/me?l=ru-RU`, {
            headers: buildHeaders(token)
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
                isStudent: Boolean(profileData.data?.student_id_number),
                groupName: profileData.data?.group?.name || null
            }
        };
    } catch (error) {
        console.error('performHemisLogin error:', error);
        return null;
    }
}

async function getCurrentSemester(hemisToken, language = 'ru-RU') {
    // 1. Приоритет: профиль студента (/v1/account/me) — точный персональный семестр
    const langParam = language ? `?l=${language}` : '';
    const url = `${process.env.HEMIS_API_BASE}/v1/account/me${langParam}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: buildHeaders(hemisToken)
        });
        if (response.status === 200) {
            const data = await response.json();
            const semesterCode = data?.data?.semester?.code;
            if (semesterCode) {
                return String(semesterCode);
            }
        }
    } catch (error) {
        console.error('Failed to fetch user profile data:', error);
    }

    // 2. Fallback: список семестров (/v1/education/semesters)
    return await getCurrentSemesterFromList(hemisToken, language);
}

async function getCurrentSemesterFromList(hemisToken, language = 'ru-RU') {
    const langParam = language ? `?l=${language}` : '';
    const url = `${process.env.HEMIS_API_BASE}/v1/education/semesters${langParam}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: buildHeaders(hemisToken)
        });
        if (response.status !== 200) {
            return null;
        }

        const data = await response.json();
        if (!data.success || !Array.isArray(data.data) || data.data.length === 0) {
            return null;
        }

        // 1. Семестр с текущей активной учебной неделей
        for (const semester of data.data) {
            if (semester.weeks && semester.weeks.some((week) => week.current === true)) {
                console.log(`Found semester with current week: code=${semester.code}, name=${semester.name}`);
                return String(semester.code);
            }
        }

        // 2. Семестр с current: true в активном учебном году
        const currentYearSemester = data.data.find(
            (semester) => semester.current === true && semester.education_year?.current === true
        );
        if (currentYearSemester) {
            console.log(`Found current semester in active education year: code=${currentYearSemester.code}, name=${currentYearSemester.name}`);
            return String(currentYearSemester.code);
        }

        // 3. Последний семестр с current: true (если в HEMIS их несколько)
        const currentSemesters = data.data.filter((semester) => semester.current === true);
        if (currentSemesters.length > 0) {
            const latestCurrent = currentSemesters[currentSemesters.length - 1];
            console.log(`Found latest semester with current=true: code=${latestCurrent.code}, name=${latestCurrent.name}`);
            return String(latestCurrent.code);
        }

        // 4. Последний семестр в списке
        const lastSemester = data.data[data.data.length - 1];
        if (lastSemester) {
            console.log(`No current semester found, using last: code=${lastSemester.code}, name=${lastSemester.name}`);
            return String(lastSemester.code);
        }

        return null;
    } catch (error) {
        console.error('Failed to fetch semesters list:', error);
        return null;
    }
}

async function getScheduleFromHemis(hemisToken, user, semesterCode, language = 'ru-RU') {
    const langParam = language ? `&l=${language}` : '';
    const url = `${process.env.HEMIS_API_BASE}/v1/education/schedule?semester=${semesterCode}${langParam}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: buildHeaders(hemisToken)
        });

        if (response.status === 401) {
            return { error: 'unauthorized' };
        }

        const data = await response.json();
        if (!data.success || !data.data) {
            return null;
        }

        return data.data.map((item) => ({
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
    } catch (error) {
        console.error('Failed to get schedule from Endpoint:', error);
        return null;
    }
}

async function getAttendanceFromHemis(hemisToken, semesterCode, language = 'ru-RU') {
    const langParam = language ? `&l=${language}` : '';
    const url = `${process.env.HEMIS_API_BASE}/v1/education/attendance?semester=${semesterCode}${langParam}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: buildHeaders(hemisToken)
        });

        if (response.status === 401) {
            return { error: 'unauthorized' };
        }

        const data = await response.json();
        if (!data.success || !data.data) {
            return null;
        }

        const subjectsMap = {};
        let totalHours = 0;
        let justifiedHours = 0;
        let unjustifiedHours = 0;

        data.data.forEach((item) => {
            const hours = (item.absent_on || 0) + (item.absent_off || 0);
            if (hours <= 0) {
                return;
            }

            totalHours += hours;
            const isJustified = item.explicable === true;

            if (isJustified) {
                justifiedHours += hours;
            } else {
                unjustifiedHours += hours;
            }

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
                date: item.lesson_date,
                time: item.lessonPair?.start_time || '',
                hours,
                isJustified
            });
        });

        const subjects = Object.values(subjectsMap).map((subject) => {
            subject.details.sort((left, right) => left.date - right.date);
            return subject;
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

module.exports = {
    performHemisLogin,
    getCurrentSemester,
    getCurrentSemesterFromList,
    getScheduleFromHemis,
    getAttendanceFromHemis,
    HEMIS_RATE_LIMIT_ERROR,
    isRateLimitedAuthResult
};
