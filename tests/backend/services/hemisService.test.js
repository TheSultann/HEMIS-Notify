const hemisService = require('../../../Backend/services/hemisService');

describe('hemisService', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
        delete process.env.HEMIS_RATE_LIMIT_COOLDOWN_MS;
    });

    test('performHemisLogin returns token and profile data on success', async () => {
        global.fetch
            .mockResolvedValueOnce({
                json: async () => ({
                    success: true,
                    data: { token: 'hemis-token' }
                })
            })
            .mockResolvedValueOnce({
                json: async () => ({
                    success: true,
                    data: {
                        full_name: 'Test Student',
                        student_id_number: '123',
                        group: { name: 'SE-101' }
                    }
                })
            });

        await expect(hemisService.performHemisLogin('login', 'password')).resolves.toEqual({
            token: 'hemis-token',
            profileData: {
                fullName: 'Test Student',
                isStudent: true,
                groupName: 'SE-101'
            }
        });
    });

    test('performHemisLogin returns null on invalid credentials', async () => {
        global.fetch.mockResolvedValue({
            json: async () => ({
                success: false,
                code: 401
            })
        });

        await expect(hemisService.performHemisLogin('bad', 'bad')).resolves.toBeNull();
    });

    test('performHemisLogin returns rate-limited marker on captcha requirement', async () => {
        global.fetch.mockResolvedValue({
            json: async () => ({
                success: false,
                code: 429,
                error: 'captcha required',
                data: { error: 'CAPTCHA_REQUIRED' }
            })
        });

        await expect(hemisService.performHemisLogin('login', 'password')).resolves.toEqual({
            error: hemisService.HEMIS_RATE_LIMIT_ERROR,
            retryAfterMs: 60 * 60 * 1000,
            message: 'captcha required'
        });
    });

    test('performHemisLogin uses configured cooldown and default captcha message for rate-limit responses', async () => {
        process.env.HEMIS_RATE_LIMIT_COOLDOWN_MS = '90000';
        global.fetch.mockResolvedValue({
            json: async () => ({
                success: false,
                code: 429,
                data: { error: 'CAPTCHA_REQUIRED' }
            })
        });

        await expect(hemisService.performHemisLogin('login', 'password')).resolves.toEqual({
            error: hemisService.HEMIS_RATE_LIMIT_ERROR,
            retryAfterMs: 90000,
            message: 'HEMIS temporarily requires captcha'
        });
    });

    test('isRateLimitedAuthResult detects only hemis rate-limit markers', () => {
        expect(hemisService.isRateLimitedAuthResult({ error: hemisService.HEMIS_RATE_LIMIT_ERROR })).toBe(true);
        expect(hemisService.isRateLimitedAuthResult({ error: 'other_error' })).toBe(false);
        expect(hemisService.isRateLimitedAuthResult(null)).toBe(false);
    });

    test('performHemisLogin returns null when profile request is unsuccessful', async () => {
        global.fetch
            .mockResolvedValueOnce({
                json: async () => ({
                    success: true,
                    data: { token: 'hemis-token' }
                })
            })
            .mockResolvedValueOnce({
                json: async () => ({
                    success: false
                })
            });

        await expect(hemisService.performHemisLogin('login', 'password')).resolves.toBeNull();
    });

    test('performHemisLogin returns null and logs non-401 login failures', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
        global.fetch.mockResolvedValue({
            json: async () => ({
                success: false,
                code: 500,
                error: 'server down'
            })
        });

        await expect(hemisService.performHemisLogin('login', 'password')).resolves.toBeNull();
        expect(logSpy).toHaveBeenCalledWith('HEMIS Login failed:', expect.objectContaining({ code: 500 }));
    });

    test('performHemisLogin returns null when fetch throws', async () => {
        global.fetch.mockRejectedValue(new Error('network'));

        await expect(hemisService.performHemisLogin('login', 'password')).resolves.toBeNull();
    });

    test('getCurrentSemesterFromList prefers explicit current semester', async () => {
        global.fetch.mockResolvedValue({
            status: 200,
            json: async () => ({
                success: true,
                data: [
                    { code: '11', current: false },
                    { code: '12', current: true }
                ]
            })
        });

        await expect(hemisService.getCurrentSemesterFromList('token')).resolves.toBe('12');
    });

    test('getCurrentSemesterFromList handles multiple current semesters by preferring active week', async () => {
        global.fetch.mockResolvedValue({
            status: 200,
            json: async () => ({
                success: true,
                data: [
                    { code: '14', current: true, weeks: [{ current: false }] },
                    { code: '15', current: true, weeks: [{ current: true }] }
                ]
            })
        });

        await expect(hemisService.getCurrentSemesterFromList('token')).resolves.toBe('15');
    });

    test('getCurrentSemesterFromList falls back to semester with current week then to last semester', async () => {
        global.fetch
            .mockResolvedValueOnce({
                status: 200,
                json: async () => ({
                    success: true,
                    data: [
                        { code: '11', weeks: [{ current: true }] },
                        { code: '12', weeks: [] }
                    ]
                })
            })
            .mockResolvedValueOnce({
                status: 200,
                json: async () => ({
                    success: true,
                    data: [
                        { code: '21', weeks: [] },
                        { code: '22', weeks: [] }
                    ]
                })
            });

        await expect(hemisService.getCurrentSemesterFromList('token')).resolves.toBe('11');
        await expect(hemisService.getCurrentSemesterFromList('token')).resolves.toBe('22');
    });

    test('getCurrentSemesterFromList returns null on invalid payload, non-200 response and fetch error', async () => {
        global.fetch
            .mockResolvedValueOnce({
                status: 200,
                json: async () => ({
                    success: true,
                    data: {}
                })
            })
            .mockResolvedValueOnce({
                status: 500,
                json: async () => ({})
            })
            .mockRejectedValueOnce(new Error('network'));

        await expect(hemisService.getCurrentSemesterFromList()).resolves.toBeNull();
        await expect(hemisService.getCurrentSemesterFromList('token')).resolves.toBeNull();
        await expect(hemisService.getCurrentSemesterFromList('token')).resolves.toBeNull();
    });

    test('getCurrentSemester returns profile semester immediately without semesters list fetch', async () => {
        global.fetch.mockResolvedValueOnce({
            status: 200,
            json: async () => ({
                success: true,
                data: {
                    semester: { code: '15' }
                }
            })
        });

        await expect(hemisService.getCurrentSemester('token')).resolves.toBe('15');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('getCurrentSemester falls back to semesters list when profile is unavailable', async () => {
        global.fetch
            .mockResolvedValueOnce({ status: 500, json: async () => ({}) })
            .mockResolvedValueOnce({
                status: 200,
                json: async () => ({
                    success: true,
                    data: [{ code: 'SPRING-2026', current: true }]
                })
            });

        await expect(hemisService.getCurrentSemester('token')).resolves.toBe('SPRING-2026');
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('getCurrentSemester falls back to semesters list when profile has no semester', async () => {
        global.fetch
            .mockResolvedValueOnce({ status: 200, json: async () => ({ data: {} }) })
            .mockResolvedValueOnce({
                status: 200,
                json: async () => ({
                    success: true,
                    data: [{ code: '16', current: true }]
                })
            });

        await expect(hemisService.getCurrentSemester('token')).resolves.toBe('16');
    });

    test('getCurrentSemester returns null when profile and semesters list both fail', async () => {
        global.fetch
            .mockResolvedValueOnce({ status: 500, json: async () => ({}) })
            .mockRejectedValueOnce(new Error('network'));

        await expect(hemisService.getCurrentSemester('token')).resolves.toBeNull();
    });

    test('getCurrentSemester returns null when profile fetch throws and semesters list returns null', async () => {
        global.fetch
            .mockRejectedValueOnce(new Error('network'))
            .mockResolvedValueOnce({ status: 404, json: async () => ({}) });

        await expect(hemisService.getCurrentSemester('token', '')).resolves.toBeNull();
    });

    test('getCurrentSemesterFromList returns null when semesters payload is an empty array', async () => {
        global.fetch.mockResolvedValue({
            status: 200,
            json: async () => ({
                success: true,
                data: []
            })
        });

        await expect(hemisService.getCurrentSemesterFromList('token')).resolves.toBeNull();
    });

    test('getScheduleFromHemis returns unauthorized marker on 401', async () => {
        global.fetch.mockResolvedValue({ status: 401 });

        await expect(hemisService.getScheduleFromHemis('token', {}, '12')).resolves.toEqual({
            error: 'unauthorized'
        });
    });

    test('getScheduleFromHemis maps response items into compact schedule data', async () => {
        global.fetch.mockResolvedValue({
            status: 200,
            json: async () => ({
                success: true,
                data: [
                    {
                        lesson_date: 1710000000,
                        lessonPair: { start_time: '08:30' },
                        subject: { name: 'Math' },
                        employee: { name: 'Teacher' },
                        group: { name: 'SE-101' },
                        auditorium: { name: 'A-1' },
                        trainingType: { name: 'Lecture' }
                    }
                ]
            })
        });

        await expect(hemisService.getScheduleFromHemis('token', {}, '12')).resolves.toEqual([
            {
                lesson_date: 1710000000,
                time: '08:30',
                subjectId: {
                    name: 'Math',
                    teacherName: 'Teacher',
                    groupName: 'SE-101',
                    auditoriumName: 'A-1',
                    lessonType: 'Lecture'
                }
            }
        ]);
    });

    test('getScheduleFromHemis returns null on unsuccessful payload', async () => {
        global.fetch.mockResolvedValue({
            status: 200,
            json: async () => ({
                success: false
            })
        });

        await expect(hemisService.getScheduleFromHemis('token', {}, '12')).resolves.toBeNull();
    });

    test('getScheduleFromHemis returns null when fetch throws', async () => {
        global.fetch.mockRejectedValue(new Error('network'));

        await expect(hemisService.getScheduleFromHemis('token', {}, '12', '')).resolves.toBeNull();
    });

    test('getAttendanceFromHemis aggregates totals and sorts details', async () => {
        global.fetch.mockResolvedValue({
            status: 200,
            json: async () => ({
                success: true,
                data: [
                    {
                        absent_on: 1,
                        absent_off: 0,
                        explicable: false,
                        lesson_date: 200,
                        lessonPair: { start_time: '10:00' },
                        subject: { name: 'Physics' }
                    },
                    {
                        absent_on: 0,
                        absent_off: 2,
                        explicable: true,
                        lesson_date: 100,
                        lessonPair: { start_time: '08:30' },
                        subject: { name: 'Physics' }
                    }
                ]
            })
        });

        await expect(hemisService.getAttendanceFromHemis('token', '12')).resolves.toEqual({
            totalHours: 3,
            justifiedHours: 2,
            unjustifiedHours: 1,
            subjects: [
                {
                    name: 'Physics',
                    totalSubjectHours: 3,
                    details: [
                        {
                            date: 100,
                            time: '08:30',
                            hours: 2,
                            isJustified: true
                        },
                        {
                            date: 200,
                            time: '10:00',
                            hours: 1,
                            isJustified: false
                        }
                    ]
                }
            ]
        });
    });

    test('getAttendanceFromHemis returns null when API payload is unsuccessful', async () => {
        global.fetch.mockResolvedValue({
            status: 200,
            json: async () => ({
                success: false
            })
        });

        await expect(hemisService.getAttendanceFromHemis('token', '12')).resolves.toBeNull();
    });

    test('getAttendanceFromHemis returns unauthorized marker on 401', async () => {
        global.fetch.mockResolvedValue({ status: 401 });

        await expect(hemisService.getAttendanceFromHemis('token', '12')).resolves.toEqual({
            error: 'unauthorized'
        });
    });

    test('getAttendanceFromHemis ignores zero-hour records and returns null on fetch error', async () => {
        global.fetch
            .mockResolvedValueOnce({
                status: 200,
                json: async () => ({
                    success: true,
                    data: [
                        {
                            absent_on: 0,
                            absent_off: 0,
                            explicable: false,
                            lesson_date: 1,
                            lessonPair: { start_time: '08:00' },
                            subject: { name: 'Math' }
                        }
                    ]
                })
            })
            .mockRejectedValueOnce(new Error('network'));

        await expect(hemisService.getAttendanceFromHemis(undefined, '12', '')).resolves.toEqual({
            totalHours: 0,
            justifiedHours: 0,
            unjustifiedHours: 0,
            subjects: []
        });
        await expect(hemisService.getAttendanceFromHemis('token', '12')).resolves.toBeNull();
    });
});
