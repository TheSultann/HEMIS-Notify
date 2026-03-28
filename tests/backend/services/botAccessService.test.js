const {
    refreshTokenIfNeeded,
    resolveUserSchedule,
    resolveUserAttendance,
    resolveGroupSchedule
} = require('../../../Backend/services/botAccessService');

function createUser(overrides = {}) {
    return {
        hemisLogin: 's1001',
        hemisToken: null,
        role: 'student',
        language: 'ru-RU',
        save: jest.fn().mockResolvedValue(undefined),
        ...overrides
    };
}

function createScheduleService() {
    return {
        performHemisLogin: jest.fn(),
        getCurrentSemester: jest.fn(),
        getScheduleFromHemis: jest.fn(),
        getAttendanceFromHemis: jest.fn()
    };
}

describe('bot access service', () => {
    test('refreshTokenIfNeeded authenticates and persists token', async () => {
        const user = createUser();
        const scheduleService = createScheduleService();
        scheduleService.performHemisLogin.mockResolvedValue({ token: 'fresh-token' });

        const result = await refreshTokenIfNeeded(user, 'secret', scheduleService);

        expect(result).toEqual({ token: 'fresh-token', rateLimited: false });
        expect(user.hemisToken).toBe('fresh-token');
        expect(user.save).toHaveBeenCalled();
    });

    test('refreshTokenIfNeeded returns rate-limited state when cooldown is active', async () => {
        const user = createUser({
            hemisRateLimitedUntil: new Date(Date.now() + 60_000)
        });
        const scheduleService = createScheduleService();

        const result = await refreshTokenIfNeeded(user, 'secret', scheduleService);

        expect(result).toEqual({ token: null, rateLimited: true });
        expect(scheduleService.performHemisLogin).not.toHaveBeenCalled();
    });

    test('refreshTokenIfNeeded reuses existing token during cooldown', async () => {
        const user = createUser({
            hemisToken: 'cached-token',
            hemisRateLimitedUntil: new Date(Date.now() + 60_000)
        });
        const scheduleService = createScheduleService();

        const result = await refreshTokenIfNeeded(user, 'secret', scheduleService);

        expect(result).toEqual({ token: 'cached-token', rateLimited: false });
        expect(scheduleService.performHemisLogin).not.toHaveBeenCalled();
    });

    test('resolveUserSchedule returns auth failure when login fails', async () => {
        const user = createUser();
        const scheduleService = createScheduleService();
        scheduleService.performHemisLogin.mockResolvedValue(null);

        await expect(resolveUserSchedule(user, 'secret', scheduleService)).resolves.toEqual({
            status: 401,
            body: { message: 'Failed to authenticate with HEMIS' }
        });
    });

    test('resolveUserSchedule returns 429 when HEMIS login is rate-limited', async () => {
        const user = createUser();
        const scheduleService = createScheduleService();
        scheduleService.performHemisLogin.mockResolvedValue({
            error: 'rate_limited',
            retryAfterMs: 60_000
        });

        await expect(resolveUserSchedule(user, 'secret', scheduleService)).resolves.toEqual({
            status: 429,
            body: { message: 'HEMIS временно ограничил вход. Попробуйте позже.' }
        });
    });

    test('resolveUserSchedule retries semester lookup and returns schedule', async () => {
        const user = createUser({ hemisToken: 'stale-token' });
        const scheduleService = createScheduleService();
        scheduleService.getCurrentSemester
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce('2026S');
        scheduleService.performHemisLogin.mockResolvedValue({ token: 'fresh-token' });
        scheduleService.getScheduleFromHemis.mockResolvedValue([{ lesson_date: 1710000000 }]);

        await expect(resolveUserSchedule(user, 'secret', scheduleService)).resolves.toEqual({
            status: 200,
            body: {
                schedule: [{ lesson_date: 1710000000 }],
                role: 'student'
            }
        });
    });

    test('resolveUserSchedule returns server error when schedule fetch is still empty after re-login', async () => {
        const user = createUser({ hemisToken: 'stale-token' });
        const scheduleService = createScheduleService();
        scheduleService.getCurrentSemester
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce('2026S');
        scheduleService.performHemisLogin.mockResolvedValue({ token: 'fresh-token' });
        scheduleService.getScheduleFromHemis.mockResolvedValue(null);

        await expect(resolveUserSchedule(user, 'secret', scheduleService)).resolves.toEqual({
            status: 500,
            body: { message: 'Failed to fetch schedule from HEMIS' }
        });
    });

    test('resolveUserSchedule keeps working with cached token during cooldown', async () => {
        const user = createUser({
            hemisToken: 'cached-token',
            hemisRateLimitedUntil: new Date(Date.now() + 60_000)
        });
        const scheduleService = createScheduleService();
        scheduleService.getCurrentSemester.mockResolvedValue('2026S');
        scheduleService.getScheduleFromHemis.mockResolvedValue([{ lesson_date: 1710000000 }]);

        await expect(resolveUserSchedule(user, 'secret', scheduleService)).resolves.toEqual({
            status: 200,
            body: {
                schedule: [{ lesson_date: 1710000000 }],
                role: 'student'
            }
        });

        expect(scheduleService.performHemisLogin).not.toHaveBeenCalled();
    });

    test('resolveUserAttendance retries after unauthorized attendance fetch', async () => {
        const user = createUser({ hemisToken: 'stale-token' });
        const scheduleService = createScheduleService();
        scheduleService.getCurrentSemester.mockResolvedValue('2026S');
        scheduleService.getAttendanceFromHemis
            .mockResolvedValueOnce({ error: 'unauthorized' })
            .mockResolvedValueOnce({ totalHours: 2, subjects: [] });
        scheduleService.performHemisLogin.mockResolvedValue({ token: 'fresh-token' });

        await expect(resolveUserAttendance(user, 'secret', scheduleService)).resolves.toEqual({
            status: 200,
            body: {
                success: true,
                data: { totalHours: 2, subjects: [] }
            }
        });
    });

    test('resolveUserAttendance returns semester not found after failed retry', async () => {
        const user = createUser({ hemisToken: 'stale-token' });
        const scheduleService = createScheduleService();
        scheduleService.getCurrentSemester.mockResolvedValue(null);
        scheduleService.performHemisLogin.mockResolvedValue({ token: 'fresh-token' });

        await expect(resolveUserAttendance(user, 'secret', scheduleService)).resolves.toEqual({
            status: 400,
            body: { message: 'Semester not found' }
        });
    });

    test('resolveUserAttendance keeps working with cached token during cooldown', async () => {
        const user = createUser({
            hemisToken: 'cached-token',
            hemisRateLimitedUntil: new Date(Date.now() + 60_000)
        });
        const scheduleService = createScheduleService();
        scheduleService.getCurrentSemester.mockResolvedValue('2026S');
        scheduleService.getAttendanceFromHemis.mockResolvedValue({ totalHours: 2, subjects: [] });

        await expect(resolveUserAttendance(user, 'secret', scheduleService)).resolves.toEqual({
            status: 200,
            body: {
                success: true,
                data: { totalHours: 2, subjects: [] }
            }
        });

        expect(scheduleService.performHemisLogin).not.toHaveBeenCalled();
    });

    test('resolveGroupSchedule returns student schedule for group sender', async () => {
        const user = createUser({ hemisToken: 'group-token' });
        const scheduleService = createScheduleService();
        scheduleService.getCurrentSemester.mockResolvedValue('2026S');
        scheduleService.getScheduleFromHemis.mockResolvedValue([{ lesson_date: 1710000000 }]);

        await expect(resolveGroupSchedule(user, 'secret', scheduleService)).resolves.toEqual({
            schedule: [{ lesson_date: 1710000000 }],
            role: 'student'
        });
    });
});
