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
    const listResult = await getCurrentSemesterFromList(hemisToken, language);
    if (listResult) {
        return listResult;
    }

    const langParam = language ? `?l=${language}` : '';
    const url = `${process.env.HEMIS_API_BASE}/v1/account/me${langParam}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: buildHeaders(hemisToken)
        });
        if (response.status !== 200) {
            return null;
        }

        const data = await response.json();
        return data?.data?.semester?.code || null;
    } catch (error) {
        console.error('Failed to fetch user profile data:', error);
        return null;
    }
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
        if (!data.success || !Array.isArray(data.data)) {
            return null;
        }

        const currentSemester = data.data.find((semester) => semester.current === true);
        if (currentSemester) {
            console.log(`Found current semester from list: code=${currentSemester.code}, name=${currentSemester.name}`);
            return currentSemester.code;
        }

        for (const semester of data.data) {
            if (semester.weeks && semester.weeks.some((week) => week.current === true)) {
                console.log(`Found semester with current week: code=${semester.code}, name=${semester.name}`);
                return semester.code;
            }
        }

        const lastSemester = data.data[data.data.length - 1];
        if (lastSemester) {
            console.log(`No current semester found, using last: code=${lastSemester.code}, name=${lastSemester.name}`);
            return lastSemester.code;
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
