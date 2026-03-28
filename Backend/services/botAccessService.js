const DEFAULT_RATE_LIMIT_MESSAGE = 'HEMIS временно ограничил вход. Попробуйте позже.';

function isUserRateLimited(user, now = Date.now()) {
    if (!user?.hemisRateLimitedUntil) {
        return false;
    }

    return new Date(user.hemisRateLimitedUntil).getTime() > now;
}

async function applyLoginResult(user, authData, now = Date.now()) {
    if (authData?.error === 'rate_limited') {
        user.hemisRateLimitedUntil = new Date(now + (authData.retryAfterMs || 60 * 60 * 1000));
        await user.save();
        return { token: null, rateLimited: true };
    }

    if (!authData?.token) {
        return { token: null, rateLimited: false };
    }

    user.hemisToken = authData.token;
    user.hemisRateLimitedUntil = null;
    await user.save();
    return { token: authData.token, rateLimited: false };
}

async function refreshTokenIfNeeded(user, plainPassword, scheduleService) {
    let hemisToken = user.hemisToken;

    if (isUserRateLimited(user)) {
        return { token: null, rateLimited: true };
    }

    if (!hemisToken) {
        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
        return applyLoginResult(user, authData);
    }

    return { token: hemisToken, rateLimited: false };
}

async function resolveUserSchedule(user, plainPassword, scheduleService) {
    const userLanguage = user.language || 'ru-RU';
    let { token: hemisToken, rateLimited } = await refreshTokenIfNeeded(user, plainPassword, scheduleService);

    if (!hemisToken) {
        return rateLimited
            ? { status: 429, body: { message: DEFAULT_RATE_LIMIT_MESSAGE } }
            : { status: 401, body: { message: 'Failed to authenticate with HEMIS' } };
    }

    const semesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
    if (!semesterCode) {
        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
        ({ token: hemisToken, rateLimited } = await applyLoginResult(user, authData));
        if (!hemisToken) {
            return rateLimited
                ? { status: 429, body: { message: DEFAULT_RATE_LIMIT_MESSAGE } }
                : { status: 401, body: { message: 'Failed to re-authenticate with HEMIS' } };
        }

        const newSemesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
        if (!newSemesterCode) {
            return { status: 400, body: { message: 'Could not determine semester even after re-login.' } };
        }

        const scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, newSemesterCode, userLanguage);
        if (scheduleResult === null || scheduleResult?.error) {
            return { status: 500, body: { message: 'Failed to fetch schedule from HEMIS' } };
        }

        return { status: 200, body: { schedule: scheduleResult, role: user.role } };
    }

    let scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, semesterCode, userLanguage);

    if (scheduleResult?.error === 'unauthorized') {
        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
        ({ token: hemisToken, rateLimited } = await applyLoginResult(user, authData));
        if (!hemisToken) {
            return rateLimited
                ? { status: 429, body: { message: DEFAULT_RATE_LIMIT_MESSAGE } }
                : { status: 401, body: { message: 'Failed to re-authenticate with HEMIS' } };
        }

        scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, semesterCode, userLanguage);
    }

    if (scheduleResult === null || scheduleResult?.error) {
        return { status: 500, body: { message: 'Failed to fetch schedule from HEMIS' } };
    }

    return { status: 200, body: { schedule: scheduleResult, role: user.role } };
}

async function resolveUserAttendance(user, plainPassword, scheduleService) {
    const userLanguage = user.language || 'ru-RU';
    let { token: hemisToken, rateLimited } = await refreshTokenIfNeeded(user, plainPassword, scheduleService);

    if (!hemisToken) {
        return rateLimited
            ? { status: 429, body: { message: DEFAULT_RATE_LIMIT_MESSAGE } }
            : { status: 401, body: { message: 'Failed to authenticate' } };
    }

    let semesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
    if (!semesterCode) {
        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
        ({ token: hemisToken, rateLimited } = await applyLoginResult(user, authData));
        if (!hemisToken) {
            return rateLimited
                ? { status: 429, body: { message: DEFAULT_RATE_LIMIT_MESSAGE } }
                : { status: 401, body: { message: 'Failed to re-authenticate' } };
        }

        semesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
    }

    if (!semesterCode) {
        return { status: 400, body: { message: 'Semester not found' } };
    }

    let attendanceData = await scheduleService.getAttendanceFromHemis(hemisToken, semesterCode, userLanguage);
    if (attendanceData?.error === 'unauthorized') {
        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
        ({ token: hemisToken, rateLimited } = await applyLoginResult(user, authData));
        if (!hemisToken) {
            return rateLimited
                ? { status: 429, body: { message: DEFAULT_RATE_LIMIT_MESSAGE } }
                : { status: 401, body: { message: 'Failed to re-authenticate' } };
        }

        attendanceData = await scheduleService.getAttendanceFromHemis(hemisToken, semesterCode, userLanguage);
    }

    if (!attendanceData) {
        return { status: 500, body: { message: 'Failed to fetch attendance' } };
    }

    return { status: 200, body: { success: true, data: attendanceData } };
}

async function resolveGroupSchedule(user, plainPassword, scheduleService) {
    const userLanguage = user.language || 'ru-RU';
    let { token: hemisToken, rateLimited } = await refreshTokenIfNeeded(user, plainPassword, scheduleService);

    if (!hemisToken) {
        throw rateLimited
            ? { status: 429, message: DEFAULT_RATE_LIMIT_MESSAGE }
            : { status: 401, message: 'РћС€РёР±РєР° Р°СѓС‚РµРЅС‚РёС„РёРєР°С†РёРё HEMIS РѕС‚ РёРјРµРЅРё СѓС‡Р°СЃС‚РЅРёРєР° РіСЂСѓРїРїС‹' };
    }

    const semesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
    if (!semesterCode) {
        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
        ({ token: hemisToken, rateLimited } = await applyLoginResult(user, authData));
        if (!hemisToken) {
            throw rateLimited
                ? { status: 429, message: DEFAULT_RATE_LIMIT_MESSAGE }
                : { status: 401, message: 'РћС€РёР±РєР° РїРѕРІС‚РѕСЂРЅРѕР№ Р°СѓС‚РµРЅС‚РёС„РёРєР°С†РёРё РІ HEMIS' };
        }

        const newSemesterCode = await scheduleService.getCurrentSemester(hemisToken, userLanguage);
        if (!newSemesterCode) {
            throw { status: 400, message: 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕРїСЂРµРґРµР»РёС‚СЊ СЃРµРјРµСЃС‚СЂ.' };
        }

        const scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, newSemesterCode, userLanguage);
        return { schedule: scheduleResult, role: 'student' };
    }

    let scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, semesterCode, userLanguage);
    if (scheduleResult?.error === 'unauthorized') {
        const authData = await scheduleService.performHemisLogin(user.hemisLogin, plainPassword);
        ({ token: hemisToken, rateLimited } = await applyLoginResult(user, authData));
        if (!hemisToken) {
            throw rateLimited
                ? { status: 429, message: DEFAULT_RATE_LIMIT_MESSAGE }
                : { status: 401, message: 'РћС€РёР±РєР° РїРѕРІС‚РѕСЂРЅРѕР№ Р°СѓС‚РµРЅС‚РёС„РёРєР°С†РёРё РІ HEMIS' };
        }

        scheduleResult = await scheduleService.getScheduleFromHemis(hemisToken, user, semesterCode, userLanguage);
    }

    if (scheduleResult === null || scheduleResult?.error) {
        throw { status: 500, message: 'РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ СЂР°СЃРїРёСЃР°РЅРёРµ РёР· HEMIS' };
    }

    return { schedule: scheduleResult, role: 'student' };
}

module.exports = {
    refreshTokenIfNeeded,
    resolveUserSchedule,
    resolveUserAttendance,
    resolveGroupSchedule
};
