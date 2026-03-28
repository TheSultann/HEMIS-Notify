const request = require('supertest');
const { startDatabase, loadServerApp, clearDatabase, stopDatabase } = require('../../helpers/testDatabase');

describe('/api/bot routes', () => {
    const authHeaders = { 'x-bot-secret': process.env.BOT_API_SECRET };
    let app;
    let mongoose;
    let hemisService;
    let User;
    let Group;
    let encrypt;
    let decrypt;

    beforeAll(async () => {
        await startDatabase();
        jest.resetModules();

        jest.doMock('../../../Backend/services/hemisService', () => ({
            performHemisLogin: jest.fn(),
            getCurrentSemester: jest.fn(),
            getCurrentSemesterFromList: jest.fn(),
            getScheduleFromHemis: jest.fn(),
            getAttendanceFromHemis: jest.fn()
        }));
        jest.doMock('../../../Backend/services/timeService', () => ({
            sleep: jest.fn().mockResolvedValue(undefined)
        }));

        ({ app, mongoose } = await loadServerApp());
        hemisService = require('../../../Backend/services/hemisService');
        User = require('../../../Backend/models/User');
        Group = require('../../../Backend/models/Group');
        ({ encrypt, decrypt } = require('../../../Backend/utils/crypto'));
    });

    beforeEach(async () => {
        Object.values(hemisService).forEach((fn) => fn.mockReset && fn.mockReset());
        await clearDatabase();
    });

    afterAll(async () => {
        await stopDatabase();
    });

    test('rejects requests without bot secret', async () => {
        await request(app)
            .get('/api/bot/stats')
            .expect(401, { message: 'Unauthorized' });
    });

    test('register creates a new student with encrypted password and initial absence stats', async () => {
        hemisService.performHemisLogin.mockResolvedValue({
            token: 'hemis-token',
            profileData: {
                fullName: 'Student One',
                isStudent: true,
                groupName: 'SE-101'
            }
        });
        hemisService.getCurrentSemester.mockResolvedValue('2026S');
        hemisService.getAttendanceFromHemis.mockResolvedValue({ totalHours: 4 });

        await request(app)
            .post('/api/bot/register')
            .set(authHeaders)
            .send({
                hemisLogin: 's1001',
                hemisPassword: 'secret',
                chatId: '1001'
            })
            .expect(200);

        const user = await User.findOne({ telegramChatId: '1001' }).lean();
        expect(user.fullName).toBe('Student One');
        expect(user.group).toBe('SE-101');
        expect(user.lastKnownAbsentHours).toBe(4);
        expect(user.hemisPassword).not.toBe('secret');
        expect(decrypt(user.hemisPassword)).toBe('secret');
    });

    test('register updates temporary user without losing selected language', async () => {
        await User.create({
            hemisLogin: 'temp_1002',
            hemisPassword: 'temp',
            telegramChatId: '1002',
            language: 'uz-UZ'
        });

        hemisService.performHemisLogin.mockResolvedValue({
            token: 'teacher-token',
            profileData: {
                fullName: 'Teacher',
                isStudent: false,
                groupName: null
            }
        });

        await request(app)
            .post('/api/bot/register')
            .set(authHeaders)
            .send({
                hemisLogin: 'teacher-1',
                hemisPassword: 'teacher-secret',
                chatId: '1002'
            })
            .expect(200);

        const user = await User.findOne({ telegramChatId: '1002' }).lean();
        expect(user.hemisLogin).toBe('teacher-1');
        expect(user.language).toBe('uz-UZ');
        expect(user.role).toBe('teacher');
    });

    test('register returns 401 on invalid HEMIS credentials', async () => {
        hemisService.performHemisLogin.mockResolvedValue(null);

        await request(app)
            .post('/api/bot/register')
            .set(authHeaders)
            .send({
                hemisLogin: 'bad',
                hemisPassword: 'bad',
                chatId: '1001'
            })
            .expect(401, { message: 'Invalid HEMIS login or password' });
    });

    test('register returns 429 when HEMIS login is temporarily rate-limited', async () => {
        hemisService.performHemisLogin.mockResolvedValue({
            error: 'rate_limited',
            retryAfterMs: 60_000
        });

        await request(app)
            .post('/api/bot/register')
            .set(authHeaders)
            .send({
                hemisLogin: 's1001',
                hemisPassword: 'secret',
                chatId: '1001'
            })
            .expect(429, { message: 'HEMIS временно ограничил вход. Попробуйте позже.' });
    });

    test('bind-group creates group binding and reports conflict for already bound group', async () => {
        await User.create({
            hemisLogin: 's1001',
            hemisPassword: encrypt('secret'),
            telegramChatId: '1001',
            group: 'SE-101'
        });

        await request(app)
            .post('/api/bot/bind-group')
            .set(authHeaders)
            .send({ groupName: 'SE-101', chatId: 'group-chat-1' })
            .expect(200);

        await request(app)
            .post('/api/bot/bind-group')
            .set(authHeaders)
            .send({ groupName: 'SE-101', chatId: 'group-chat-2' })
            .expect(409);

        expect(await Group.countDocuments()).toBe(1);
    });

    test('unbind-group deletes linked group and returns 404 when chat is not bound', async () => {
        await Group.create({ groupName: 'SE-101', telegramChatId: 'group-chat-1' });

        await request(app)
            .post('/api/bot/unbind-group')
            .set(authHeaders)
            .send({ chatId: 'group-chat-1' })
            .expect(200);

        expect(await Group.countDocuments()).toBe(0);

        await request(app)
            .post('/api/bot/unbind-group')
            .set(authHeaders)
            .send({ chatId: 'group-chat-1' })
            .expect(404);
    });

    test('group-last-schedule-message stores the latest scheduled group message id', async () => {
        await Group.create({ groupName: 'SE-101', telegramChatId: 'group-chat-1' });

        await request(app)
            .post('/api/bot/group-last-schedule-message')
            .set(authHeaders)
            .send({ chatId: 'group-chat-1', messageId: 321 })
            .expect(200, { success: true });

        const group = await Group.findOne({ telegramChatId: 'group-chat-1' }).lean();
        expect(group.lastScheduleMessageId).toBe(321);
    });

    test('bind-by-user returns 404 for unknown user and binds group for registered user', async () => {
        await request(app)
            .post('/api/bot/bind-by-user')
            .set(authHeaders)
            .send({ groupChatId: 'group-chat-1', userTelegramId: '404' })
            .expect(404, { message: 'user_not_found' });

        await User.create({
            hemisLogin: 's1001',
            hemisPassword: encrypt('secret'),
            telegramChatId: '1001',
            fullName: 'Student One',
            group: 'SE-101'
        });

        const response = await request(app)
            .post('/api/bot/bind-by-user')
            .set(authHeaders)
            .send({ groupChatId: 'group-chat-1', userTelegramId: '1001' })
            .expect(200);

        expect(response.body).toMatchObject({
            success: true,
            groupName: 'SE-101',
            studentName: 'Student One'
        });
    });

    test('set-language creates a temporary user before registration and validates input', async () => {
        await request(app)
            .post('/api/bot/set-language')
            .set(authHeaders)
            .send({ chatId: '2001', language: 'uz-UZ' })
            .expect(200, {
                success: true,
                message: 'Language updated successfully'
            });

        const tempUser = await User.findOne({ telegramChatId: '2001' }).lean();
        expect(tempUser.hemisLogin).toBe('temp_2001');
        expect(tempUser.language).toBe('uz-UZ');

        await request(app)
            .post('/api/bot/set-language')
            .set(authHeaders)
            .send({ chatId: '2001', language: 'en-US' })
            .expect(400, { message: 'Invalid language. Must be ru-RU or uz-UZ' });
    });

    test('me and language endpoints return saved profile data', async () => {
        await User.create({
            hemisLogin: 'student-1',
            hemisPassword: encrypt('secret'),
            telegramChatId: '1001',
            fullName: 'Student One',
            role: 'student',
            group: 'SE-101',
            language: 'uz-UZ'
        });

        const meResponse = await request(app)
            .get('/api/bot/me/1001')
            .set(authHeaders)
            .expect(200);

        expect(meResponse.body).toEqual({
            success: true,
            data: {
                fullName: 'Student One',
                group: 'SE-101',
                hemisLogin: 'student-1',
                role: 'student',
                language: 'uz-UZ'
            }
        });

        await request(app)
            .get('/api/bot/language/1001')
            .set(authHeaders)
            .expect(200, {
                success: true,
                language: 'uz-UZ'
            });
    });

    test('schedule route re-authenticates when token is missing', async () => {
        await User.create({
            hemisLogin: 's1001',
            hemisPassword: encrypt('secret'),
            telegramChatId: '1001',
            role: 'student'
        });

        hemisService.performHemisLogin.mockResolvedValue({ token: 'new-token' });
        hemisService.getCurrentSemester.mockResolvedValue('2026S');
        hemisService.getScheduleFromHemis.mockResolvedValue([{ lesson_date: 1710000000 }]);

        const response = await request(app)
            .get('/api/bot/schedule/1001')
            .set(authHeaders)
            .expect(200);

        expect(response.body).toEqual({
            schedule: [{ lesson_date: 1710000000 }],
            role: 'student'
        });

        const user = await User.findOne({ telegramChatId: '1001' }).lean();
        expect(user.hemisToken).toBe('new-token');
    });

    test('schedule route retries after unauthorized schedule fetch', async () => {
        await User.create({
            hemisLogin: 's1001',
            hemisPassword: encrypt('secret'),
            telegramChatId: '1001',
            role: 'student',
            hemisToken: 'stale-token'
        });

        hemisService.getCurrentSemester.mockResolvedValue('2026S');
        hemisService.getScheduleFromHemis
            .mockResolvedValueOnce({ error: 'unauthorized' })
            .mockResolvedValueOnce([{ lesson_date: 1710000000 }]);
        hemisService.performHemisLogin.mockResolvedValue({ token: 'fresh-token' });

        await request(app)
            .get('/api/bot/schedule/1001')
            .set(authHeaders)
            .expect(200, {
                schedule: [{ lesson_date: 1710000000 }],
                role: 'student'
            });

        expect(hemisService.performHemisLogin).toHaveBeenCalled();
    });

    test('group schedule by chat id resolves bound group through a registered student', async () => {
        await Group.create({ groupName: 'SE-101', telegramChatId: 'group-chat-1' });
        await User.create({
            hemisLogin: 'student-1',
            hemisPassword: encrypt('secret'),
            telegramChatId: '1001',
            role: 'student',
            group: 'SE-101'
        });

        hemisService.performHemisLogin.mockResolvedValue({ token: 'group-token' });
        hemisService.getCurrentSemester.mockResolvedValue('2026S');
        hemisService.getScheduleFromHemis.mockResolvedValue([{ lesson_date: 1710000000 }]);

        const response = await request(app)
            .get('/api/bot/schedule/group-by-chat-id/group-chat-1')
            .set(authHeaders)
            .expect(200);

        expect(response.body).toEqual({
            schedule: [{ lesson_date: 1710000000 }],
            role: 'student',
            groupName: 'SE-101'
        });

        const user = await User.findOne({ telegramChatId: '1001' }).lean();
        expect(user.hemisToken).toBe('group-token');
    });

    test('attendance route is available only for students', async () => {
        await User.create({
            hemisLogin: 'teacher-1',
            hemisPassword: encrypt('secret'),
            telegramChatId: '1001',
            role: 'teacher'
        });

        await request(app)
            .get('/api/bot/attendance/1001')
            .set(authHeaders)
            .expect(400, { message: 'Only students have attendance records' });
    });

    test('attendance route retries after unauthorized attendance fetch', async () => {
        await User.create({
            hemisLogin: 'student-1',
            hemisPassword: encrypt('secret'),
            telegramChatId: '1001',
            role: 'student',
            hemisToken: 'stale-token'
        });

        hemisService.getCurrentSemester.mockResolvedValue('2026S');
        hemisService.getAttendanceFromHemis
            .mockResolvedValueOnce({ error: 'unauthorized' })
            .mockResolvedValueOnce({
                totalHours: 3,
                justifiedHours: 1,
                unjustifiedHours: 2,
                subjects: []
            });
        hemisService.performHemisLogin.mockResolvedValue({ token: 'fresh-token' });

        const response = await request(app)
            .get('/api/bot/attendance/1001')
            .set(authHeaders)
            .expect(200);

        expect(response.body).toEqual({
            success: true,
            data: {
                totalHours: 3,
                justifiedHours: 1,
                unjustifiedHours: 2,
                subjects: []
            }
        });
    });

    test('check-new-absences stores baseline without notifications on first run', async () => {
        await User.create({
            hemisLogin: 's1001',
            hemisPassword: encrypt('secret'),
            telegramChatId: '1001',
            role: 'student',
            lastKnownAbsentHours: -1
        });

        hemisService.getCurrentSemester.mockResolvedValue('2026S');
        hemisService.getAttendanceFromHemis.mockResolvedValue({
            totalHours: 3,
            subjects: []
        });

        const response = await request(app)
            .post('/api/bot/check-new-absences')
            .set(authHeaders)
            .send({})
            .expect(200);

        expect(response.body.notifications).toEqual([]);

        const user = await User.findOne({ telegramChatId: '1001' }).lean();
        expect(user.lastKnownAbsentHours).toBe(3);
        expect(user.lastSemesterCode).toBe('2026S');
    });

    test('check-new-absences ignores temporary onboarding users', async () => {
        await User.create([
            {
                hemisLogin: 'temp_1001',
                hemisPassword: 'temp',
                telegramChatId: '1001',
                role: 'student',
                lastKnownAbsentHours: -1
            },
            {
                hemisLogin: 's1002',
                hemisPassword: encrypt('secret'),
                telegramChatId: '1002',
                role: 'student',
                lastKnownAbsentHours: -1
            }
        ]);

        hemisService.getCurrentSemester.mockResolvedValue('2026S');
        hemisService.getAttendanceFromHemis.mockResolvedValue({
            totalHours: 2,
            subjects: []
        });

        await request(app)
            .post('/api/bot/check-new-absences')
            .set(authHeaders)
            .send({})
            .expect(200, {
                success: true,
                notifications: []
            });

        expect(hemisService.getAttendanceFromHemis).toHaveBeenCalledTimes(1);

        const tempUser = await User.findOne({ telegramChatId: '1001' }).lean();
        const activeUser = await User.findOne({ telegramChatId: '1002' }).lean();

        expect(tempUser.lastKnownAbsentHours).toBe(-1);
        expect(activeUser.lastKnownAbsentHours).toBe(2);
    });

    test('check-new-absences skips users with active HEMIS rate-limit cooldown', async () => {
        await User.create({
            hemisLogin: 's1001',
            hemisPassword: encrypt('secret'),
            telegramChatId: '1001',
            role: 'student',
            hemisRateLimitedUntil: new Date(Date.now() + 60_000),
            lastKnownAbsentHours: -1
        });

        await request(app)
            .post('/api/bot/check-new-absences')
            .set(authHeaders)
            .send({})
            .expect(200, {
                success: true,
                notifications: []
            });

        expect(hemisService.getCurrentSemester).not.toHaveBeenCalled();
        expect(hemisService.performHemisLogin).not.toHaveBeenCalled();
    });

    test('check-new-absences continues processing after per-user failure', async () => {
        const latestDate = Math.floor(Date.parse('2026-03-10T00:00:00.000Z') / 1000);

        await User.create([
            {
                hemisLogin: 's1001',
                hemisPassword: encrypt('secret-1'),
                telegramChatId: '1001',
                role: 'student',
                lastKnownAbsentHours: 1,
                lastSemesterCode: '2026S'
            },
            {
                hemisLogin: 's1002',
                hemisPassword: encrypt('secret-2'),
                telegramChatId: '1002',
                role: 'student',
                lastKnownAbsentHours: 1,
                lastSemesterCode: '2026S'
            }
        ]);

        hemisService.getCurrentSemester
            .mockImplementationOnce(() => {
                throw new Error('boom');
            })
            .mockResolvedValueOnce('2026S');

        hemisService.getAttendanceFromHemis.mockResolvedValueOnce({
            totalHours: 4,
            subjects: [
                {
                    name: 'Physics',
                    details: [{ date: latestDate, hours: 3 }]
                }
            ]
        });

        const response = await request(app)
            .post('/api/bot/check-new-absences')
            .set(authHeaders)
            .send({})
            .expect(200);

        expect(response.body.notifications).toEqual([
            {
                chatId: '1002',
                diff: 3,
                total: 4,
                latestSubject: 'Physics',
                latestDate
            }
        ]);
    });

    test('stats excludes temporary users from audience totals', async () => {
        const now = new Date();

        await User.create([
            {
                hemisLogin: 'temp_1001',
                hemisPassword: 'temp',
                telegramChatId: '1001',
                role: 'student',
                createdAt: now,
                lastActiveAt: now
            },
            {
                hemisLogin: 'student-1',
                hemisPassword: encrypt('secret'),
                telegramChatId: '1002',
                role: 'student',
                group: 'SE-101',
                createdAt: now,
                lastActiveAt: now
            }
        ]);
        await Group.create({ groupName: 'SE-101', telegramChatId: 'group-chat-1' });

        const response = await request(app)
            .get('/api/bot/stats')
            .set(authHeaders)
            .expect(200);

        expect(response.body.audience.total).toBe(1);
        expect(response.body.growth.today).toBe(1);
        expect(response.body.system.groups).toBe(1);
        expect(response.body.system.chats).toBe(1);
    });

    test('groups and subscribers endpoints return bot-facing lists without internal ids and exclude temporary or blocked users', async () => {
        await Group.create({ groupName: 'SE-101', telegramChatId: 'group-chat-1' });
        await User.create([
            {
                hemisLogin: 'student-1',
                hemisPassword: encrypt('secret'),
                telegramChatId: '1001',
                role: 'student'
            },
            {
                hemisLogin: 'teacher-1',
                hemisPassword: encrypt('secret'),
                telegramChatId: '1002',
                role: 'teacher'
            },
            {
                hemisLogin: 'temp_1003',
                hemisPassword: 'temp',
                telegramChatId: '1003',
                role: 'student'
            },
            {
                hemisLogin: 'blocked-1004',
                hemisPassword: encrypt('secret'),
                telegramChatId: '1004',
                role: 'student',
                isBlocked: true
            }
        ]);

        const groupsResponse = await request(app)
            .get('/api/bot/groups')
            .set(authHeaders)
            .expect(200);
        const subscribersResponse = await request(app)
            .get('/api/bot/subscribers')
            .set(authHeaders)
            .expect(200);

        expect(groupsResponse.body).toEqual([
            {
                telegramChatId: 'group-chat-1',
                groupName: 'SE-101',
                lastScheduleMessageId: null
            }
        ]);
        expect(subscribersResponse.body).toEqual([
            {
                telegramChatId: '1001',
                role: 'student'
            },
            {
                telegramChatId: '1002',
                role: 'teacher'
            }
        ]);
    });

    test('logout removes user and activity updates liveness flags', async () => {
        await User.create({
            hemisLogin: 'student-1',
            hemisPassword: encrypt('secret'),
            telegramChatId: '1001',
            role: 'student'
        });

        await request(app)
            .post('/api/bot/activity')
            .set(authHeaders)
            .send({ chatId: '1001', isBlocked: true })
            .expect(200);

        let user = await User.findOne({ telegramChatId: '1001' }).lean();
        expect(user.isBlocked).toBe(true);
        expect(user.lastActiveAt).toBeTruthy();

        await request(app)
            .post('/api/bot/activity')
            .set(authHeaders)
            .send({ chatId: '1001' })
            .expect(200);

        user = await User.findOne({ telegramChatId: '1001' }).lean();
        expect(user.isBlocked).toBe(false);

        await request(app)
            .post('/api/bot/logout')
            .set(authHeaders)
            .send({ chatId: '1001' })
            .expect(200, {
                success: true,
                message: 'Logged out successfully'
            });

        user = await User.findOne({ telegramChatId: '1001' }).lean();
        expect(user).toBeNull();
    });

    test('delivery-failed blocks personal chats and removes stale group chats', async () => {
        await User.create({
            hemisLogin: 'student-1',
            hemisPassword: encrypt('secret'),
            telegramChatId: '1001',
            role: 'student',
            isBlocked: false
        });
        await Group.create({ groupName: 'SE-101', telegramChatId: 'group-chat-1' });

        await request(app)
            .post('/api/bot/delivery-failed')
            .set(authHeaders)
            .send({ chatId: '1001', chatType: 'private' })
            .expect(200);

        let user = await User.findOne({ telegramChatId: '1001' }).lean();
        expect(user.isBlocked).toBe(true);

        await request(app)
            .post('/api/bot/delivery-failed')
            .set(authHeaders)
            .send({ chatId: 'group-chat-1', chatType: 'group' })
            .expect(200);

        const group = await Group.findOne({ telegramChatId: 'group-chat-1' }).lean();
        expect(group).toBeNull();
    });
});
