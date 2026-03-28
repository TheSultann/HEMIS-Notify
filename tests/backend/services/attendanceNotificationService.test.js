const { processAttendanceDiff } = require('../../../Backend/services/attendanceNotificationService');

function createUser(overrides = {}) {
    return {
        telegramChatId: '1001',
        hemisLogin: 'student-1',
        lastKnownAbsentHours: 0,
        lastSemesterCode: '2026S',
        save: jest.fn().mockResolvedValue(undefined),
        ...overrides
    };
}

describe('attendanceNotificationService', () => {
    test('stores baseline on first run without notifications', async () => {
        const user = createUser({
            lastKnownAbsentHours: -1,
            lastSemesterCode: null
        });
        const notifications = [];

        await processAttendanceDiff({
            user,
            currentData: { totalHours: 4, subjects: [] },
            notifications,
            semesterCode: '2026S'
        });

        expect(notifications).toEqual([]);
        expect(user.lastKnownAbsentHours).toBe(4);
        expect(user.lastSemesterCode).toBe('2026S');
        expect(user.save).toHaveBeenCalled();
    });

    test('silently resets counter when semester changes', async () => {
        const user = createUser({
            lastKnownAbsentHours: 2,
            lastSemesterCode: '2025F'
        });
        const notifications = [];

        await processAttendanceDiff({
            user,
            currentData: { totalHours: 5, subjects: [] },
            notifications,
            semesterCode: '2026S'
        });

        expect(notifications).toEqual([]);
        expect(user.lastKnownAbsentHours).toBe(5);
        expect(user.lastSemesterCode).toBe('2026S');
    });

    test('creates notification when absences increase', async () => {
        const user = createUser({
            lastKnownAbsentHours: 1,
            lastSemesterCode: '2026S'
        });
        const notifications = [];
        const latestDate = Math.floor(Date.parse('2026-03-10T00:00:00.000Z') / 1000);

        await processAttendanceDiff({
            user,
            currentData: {
                totalHours: 3,
                subjects: [
                    {
                        name: 'Physics',
                        details: [{ date: latestDate, hours: 2 }]
                    }
                ]
            },
            notifications,
            semesterCode: '2026S'
        });

        expect(notifications).toEqual([
            {
                chatId: '1001',
                diff: 2,
                total: 3,
                latestSubject: 'Physics',
                latestDate
            }
        ]);
    });

    test('ignores old NB entries older than 30 days', async () => {
        const user = createUser({
            lastKnownAbsentHours: 1,
            lastSemesterCode: '2026S'
        });
        const notifications = [];
        const now = Date.parse('2026-03-17T00:00:00.000Z');
        const oldDate = Math.floor((now - 40 * 24 * 60 * 60 * 1000) / 1000);

        await processAttendanceDiff({
            user,
            currentData: {
                totalHours: 4,
                subjects: [
                    {
                        name: 'Math',
                        details: [{ date: oldDate, hours: 3 }]
                    }
                ]
            },
            notifications,
            semesterCode: '2026S',
            now
        });

        expect(notifications).toEqual([]);
        expect(user.lastKnownAbsentHours).toBe(4);
    });

    test('updates baseline when absences decrease', async () => {
        const user = createUser({
            lastKnownAbsentHours: 5,
            lastSemesterCode: '2026S'
        });

        await processAttendanceDiff({
            user,
            currentData: { totalHours: 2, subjects: [] },
            notifications: [],
            semesterCode: '2026S'
        });

        expect(user.lastKnownAbsentHours).toBe(2);
        expect(user.save).toHaveBeenCalled();
    });

    test('stores semester code when it was missing but no notification should be sent yet', async () => {
        const user = createUser({
            lastKnownAbsentHours: 2,
            lastSemesterCode: null
        });
        const notifications = [];

        await processAttendanceDiff({
            user,
            currentData: { totalHours: 2, subjects: [] },
            notifications,
            semesterCode: '2026S'
        });

        expect(notifications).toEqual([]);
        expect(user.lastSemesterCode).toBe('2026S');
        expect(user.lastKnownAbsentHours).toBe(2);
    });
});
