const i18n = require('../../TelegramBot/i18n');
const { FakeTelegramBot } = require('../helpers/fakeTelegramBot');
const { createFakeCron } = require('../helpers/fakeCron');

describe('Telegram bot scenarios', () => {
    let fakeBot;
    let fakeCron;
    let axiosMock;
    let startBot;
    let originalSetInterval;

    beforeEach(() => {
        jest.resetModules();
        fakeBot = new FakeTelegramBot();
        fakeCron = createFakeCron();
        axiosMock = {
            get: jest.fn(),
            post: jest.fn().mockResolvedValue({ data: { success: true } })
        };
        originalSetInterval = global.setInterval;
        global.setInterval = jest.fn(() => 1);

        jest.doMock('node-telegram-bot-api', () => jest.fn(() => fakeBot));
        jest.doMock('axios', () => axiosMock);
        jest.doMock('node-cron', () => fakeCron.cron);

        startBot = require('../../TelegramBot/bot').startBot;
        startBot();
    });

    afterEach(() => {
        global.setInterval = originalSetInterval;
    });

    test('login flow asks for login, password and sends success menu after registration', async () => {
        axiosMock.get.mockResolvedValue({ data: { language: 'ru-RU' } });
        axiosMock.post.mockImplementation((url) => {
            if (url.includes('/api/bot/register')) {
                return Promise.resolve({ data: { success: true } });
            }
            return Promise.resolve({ data: { success: true } });
        });

        await fakeBot.emitText('/login');
        await fakeBot.emitText('S12345');
        await fakeBot.emitText('very-secret');

        expect(fakeBot.sendMessage).toHaveBeenCalledWith(
            1001,
            i18n.t('ru-RU', 'enterHemisLogin'),
            expect.objectContaining({ parse_mode: 'HTML' })
        );
        expect(fakeBot.sendMessage).toHaveBeenCalledWith(
            1001,
            i18n.t('ru-RU', 'enterHemisPassword'),
            expect.objectContaining({ parse_mode: 'HTML' })
        );
        expect(axiosMock.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/bot/register'),
            expect.objectContaining({
                hemisLogin: 'S12345',
                hemisPassword: 'very-secret',
                chatId: '1001'
            }),
            expect.any(Object)
        );
    });

    test('language callback switches to onboarding flow for unregistered user', async () => {
        axiosMock.post.mockResolvedValue({ data: { success: true } });
        axiosMock.get.mockImplementation((url) => {
            if (url.includes('/api/bot/schedule/1001')) {
                return Promise.reject(new Error('not found'));
            }
            return Promise.resolve({ data: { language: 'ru-RU' } });
        });

        await fakeBot.emitEvent('callback_query', {
            id: 'cb-1',
            data: 'lang_ru-RU',
            message: {
                message_id: 50,
                chat: { id: 1001, type: 'private' }
            }
        });

        expect(fakeBot.answerCallbackQuery).toHaveBeenCalledWith('cb-1');
        expect(fakeBot.sendMessage).toHaveBeenCalledWith(
            1001,
            expect.stringContaining(i18n.t('ru-RU', 'languageChanged'))
        );
        expect(fakeBot.sendMessage).toHaveBeenCalledWith(
            1001,
            i18n.t('ru-RU', 'welcomeOnboarding'),
            { parse_mode: 'HTML' }
        );
        expect(fakeBot.sendMessage).toHaveBeenCalledWith(
            1001,
            i18n.t('ru-RU', 'enterHemisLogin'),
            expect.objectContaining({ parse_mode: 'HTML' })
        );
    });

    test('start command shows language selector when user has no saved language', async () => {
        axiosMock.get.mockImplementation((url) => {
            if (url.includes('/api/bot/language/1001')) {
                return Promise.resolve({ data: { language: null } });
            }
            return Promise.resolve({ data: {} });
        });

        await fakeBot.emitText('/start');

        expect(fakeBot.sendMessage).toHaveBeenCalledWith(
            1001,
            i18n.t('ru-RU', 'selectLanguage'),
            expect.objectContaining({
                reply_markup: expect.objectContaining({
                    inline_keyboard: expect.any(Array)
                })
            })
        );
    });

    test('start command sends welcome back menu for registered admin user', async () => {
        axiosMock.get.mockImplementation((url) => {
            if (url.includes('/api/bot/language/9999')) {
                return Promise.resolve({ data: { language: 'ru-RU' } });
            }
            if (url.includes('/api/bot/schedule/9999')) {
                return Promise.resolve({ data: { schedule: [], role: 'student' } });
            }
            return Promise.resolve({ data: {} });
        });

        await fakeBot.emitText('/start', {
            chat: { id: 9999, type: 'private' },
            from: { id: 9999 }
        });

        const adminWelcomeCall = fakeBot.sendMessage.mock.calls.find(
            ([chatId, text]) => chatId === 9999 && text === i18n.t('ru-RU', 'welcomeBack')
        );

        expect(adminWelcomeCall).toBeTruthy();
        expect(adminWelcomeCall[2].reply_markup.keyboard[2]).toEqual(
            expect.arrayContaining([
                expect.stringContaining('Статистика'),
                expect.stringContaining('Рассылка')
            ])
        );
    });

    test('schedule pagination callback edits schedule message', async () => {
        const lessonDate = Math.floor(new Date('2026-03-17T08:30:00+05:00').getTime() / 1000);

        axiosMock.get.mockImplementation((url) => {
            if (url.includes('/api/bot/language/1001')) {
                return Promise.resolve({ data: { language: 'ru-RU' } });
            }
            if (url.includes('/api/bot/schedule/1001')) {
                return Promise.resolve({
                    data: {
                        role: 'student',
                        schedule: [{
                            lesson_date: lessonDate,
                            time: '08:30',
                            subjectId: {
                                name: 'Math',
                                teacherName: 'Teacher',
                                groupName: 'SE-101',
                                auditoriumName: 'A-1',
                                lessonType: 'Lecture'
                            }
                        }]
                    }
                });
            }
            if (url.includes('/api/bot/me/1001')) {
                return Promise.resolve({ data: { data: { group: 'SE-101' } } });
            }
            return Promise.resolve({ data: {} });
        });

        await fakeBot.emitEvent('callback_query', {
            id: 'cb-2',
            data: 'sched_2026-03-17',
            message: {
                message_id: 77,
                chat: { id: 1001, type: 'private' }
            }
        });

        expect(fakeBot.editMessageText).toHaveBeenCalledWith(
            expect.stringContaining('SE-101'),
            expect.objectContaining({
                message_id: 77,
                parse_mode: 'HTML'
            })
        );
    });

    test('bind_me blocks non-admin user in group chat', async () => {
        fakeBot.getChatMember.mockResolvedValue({ status: 'member' });

        await fakeBot.emitText('/bind_me', {
            chat: { id: -100, type: 'group' },
            from: { id: 500 }
        });

        expect(fakeBot.sendMessage).toHaveBeenCalledWith(
            -100,
            'Только администраторы могут привязывать группу.'
        );
    });

    test('admin broadcast can be cancelled after target selection', async () => {
        await fakeBot.emitText('📢 Рассылка', {
            chat: { id: 9999, type: 'private' },
            from: { id: 9999 }
        });

        await fakeBot.emitEvent('callback_query', {
            id: 'bc-1',
            data: 'bc_target_students',
            message: {
                message_id: 80,
                chat: { id: 9999, type: 'private' }
            }
        });
        await fakeBot.emitEvent('callback_query', {
            id: 'bc-2',
            data: 'bc_cancel',
            message: {
                message_id: 80,
                chat: { id: 9999, type: 'private' }
            }
        });

        expect(fakeBot.sendMessage).toHaveBeenCalledWith(
            9999,
            '❌ Рассылка отменена.'
        );
    });

    test('admin broadcast sends preview and delivers message to subscribers', async () => {
        axiosMock.get.mockImplementation((url) => {
            if (url.includes('/api/bot/subscribers')) {
                return Promise.resolve({
                    data: [
                        { telegramChatId: '2001' },
                        { telegramChatId: '2002' }
                    ]
                });
            }
            if (url.includes('/api/bot/language/9999')) {
                return Promise.resolve({ data: { language: 'ru-RU' } });
            }
            return Promise.resolve({ data: { language: 'ru-RU' } });
        });

        await fakeBot.emitText('📢 Рассылка', {
            chat: { id: 9999, type: 'private' },
            from: { id: 9999 }
        });
        await fakeBot.emitEvent('callback_query', {
            id: 'bc-3',
            data: 'bc_target_students',
            message: {
                message_id: 81,
                chat: { id: 9999, type: 'private' }
            }
        });
        await fakeBot.emitText('Hello subscribers', {
            chat: { id: 9999, type: 'private' },
            from: { id: 9999 }
        });
        await fakeBot.emitEvent('callback_query', {
            id: 'bc-4',
            data: 'bc_send',
            message: {
                message_id: 82,
                chat: { id: 9999, type: 'private' }
            }
        });

        expect(fakeBot.sendMessage).toHaveBeenCalledWith(
            '2001',
            'Hello subscribers',
            { parse_mode: 'HTML' }
        );
        expect(fakeBot.sendMessage).toHaveBeenCalledWith(
            '2002',
            'Hello subscribers',
            { parse_mode: 'HTML' }
        );
        expect(fakeBot.sendMessage).toHaveBeenCalledWith(
            9999,
            expect.stringContaining('Отправлено: 2'),
            { parse_mode: 'HTML' }
        );
    });

    test('registers three cron jobs and morning job sends group and personal schedule', async () => {
        const lessonDate = Math.floor(new Date('2026-03-17T08:30:00+05:00').getTime() / 1000);

        axiosMock.get.mockImplementation((url) => {
            if (url.includes('/api/bot/groups')) {
                return Promise.resolve({ data: [{ groupName: 'SE-101', telegramChatId: '-100', lastScheduleMessageId: null }] });
            }
            if (url.includes('/api/bot/schedule/group/')) {
                return Promise.resolve({
                    data: {
                        schedule: [{
                            lesson_date: lessonDate,
                            time: '08:30',
                            subjectId: {
                                name: 'Math',
                                teacherName: 'Teacher',
                                groupName: 'SE-101',
                                auditoriumName: 'A-1',
                                lessonType: 'Lecture'
                            }
                        }]
                    }
                });
            }
            if (url.includes('/api/bot/subscribers')) {
                return Promise.resolve({ data: [{ telegramChatId: '1001' }] });
            }
            if (url.includes('/api/bot/language/1001')) {
                return Promise.resolve({ data: { language: 'ru-RU' } });
            }
            if (url.includes('/api/bot/me/1001')) {
                return Promise.resolve({ data: { data: { group: 'SE-101' } } });
            }
            if (url.includes('/api/bot/schedule/1001')) {
                return Promise.resolve({
                    data: {
                        role: 'student',
                        schedule: [{
                            lesson_date: lessonDate,
                            time: '08:30',
                            subjectId: {
                                name: 'Math',
                                teacherName: 'Teacher',
                                groupName: 'SE-101',
                                auditoriumName: 'A-1',
                                lessonType: 'Lecture'
                            }
                        }]
                    }
                });
            }
            return Promise.resolve({ data: {} });
        });

        expect(fakeCron.jobs).toHaveLength(3);

        await fakeCron.jobs[0].handler();

        expect(fakeBot.sendMessage).toHaveBeenCalledWith(
            '-100',
            expect.stringContaining('SE-101'),
            expect.objectContaining({
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        expect.objectContaining({
                            callback_data: expect.stringMatching(/^sched_\d{4}-\d{2}-\d{2}$/),
                            style: 'primary'
                        }),
                        expect.objectContaining({
                            callback_data: expect.stringMatching(/^sched_\d{4}-\d{2}-\d{2}$/),
                            style: 'primary'
                        })
                    ]]
                }
            })
        );
        expect(fakeBot.pinChatMessage).toHaveBeenCalled();
        expect(fakeBot.sendMessage).toHaveBeenCalledWith(
            '1001',
            expect.stringContaining('SE-101'),
            expect.objectContaining({
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        expect.objectContaining({
                            callback_data: expect.stringMatching(/^sched_\d{4}-\d{2}-\d{2}$/),
                            style: 'primary'
                        }),
                        expect.objectContaining({
                            callback_data: expect.stringMatching(/^sched_\d{4}-\d{2}-\d{2}$/),
                            style: 'primary'
                        })
                    ]]
                }
            })
        );
    });

    test('morning group cron deletes previous scheduled message after sending a new one', async () => {
        const lessonDate = Math.floor(new Date('2026-03-17T08:30:00+05:00').getTime() / 1000);

        axiosMock.get.mockImplementation((url) => {
            if (url.includes('/api/bot/groups')) {
                return Promise.resolve({
                    data: [{
                        groupName: 'SE-101',
                        telegramChatId: '-100',
                        lastScheduleMessageId: 555
                    }]
                });
            }
            if (url.includes('/api/bot/schedule/group/')) {
                return Promise.resolve({
                    data: {
                        schedule: [{
                            lesson_date: lessonDate,
                            time: '08:30',
                            subjectId: {
                                name: 'Math',
                                teacherName: 'Teacher',
                                groupName: 'SE-101',
                                auditoriumName: 'A-1',
                                lessonType: 'Lecture'
                            }
                        }]
                    }
                });
            }
            if (url.includes('/api/bot/subscribers')) {
                return Promise.resolve({ data: [] });
            }
            return Promise.resolve({ data: {} });
        });

        await fakeCron.jobs[0].handler();

        expect(fakeBot.deleteMessage).toHaveBeenCalledWith('-100', 555);
        expect(axiosMock.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/bot/group-last-schedule-message'),
            {
                chatId: '-100',
                messageId: expect.any(Number)
            },
            expect.any(Object)
        );
    });

    test('unbind_group removes binding for admin group user', async () => {
        axiosMock.get.mockResolvedValue({ data: { language: 'ru-RU' } });
        axiosMock.post.mockImplementation((url) => {
            if (url.includes('/api/bot/unbind-group')) {
                return Promise.resolve({ data: { success: true, message: 'Group unbound.' } });
            }
            return Promise.resolve({ data: { success: true } });
        });
        fakeBot.getChatMember.mockResolvedValue({ status: 'administrator' });

        await fakeBot.emitText('/unbind_group', {
            chat: { id: -100, type: 'group' },
            from: { id: 500 }
        });

        expect(axiosMock.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/bot/unbind-group'),
            { chatId: '-100' },
            expect.any(Object)
        );
        expect(fakeBot.sendMessage).toHaveBeenCalledWith(
            -100,
            expect.stringContaining('Group unbound.')
        );
    });

    test('logout command removes account and returns guest menu', async () => {
        axiosMock.get.mockResolvedValue({ data: { language: 'ru-RU' } });
        axiosMock.post.mockImplementation((url) => {
            if (url.includes('/api/bot/logout')) {
                return Promise.resolve({ data: { success: true } });
            }
            return Promise.resolve({ data: { success: true } });
        });

        await fakeBot.emitText('/logout');

        expect(axiosMock.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/bot/logout'),
            { chatId: '1001' },
            expect.any(Object)
        );
        const logoutCall = fakeBot.sendMessage.mock.calls.find(
            ([chatId, text]) => chatId === 1001 && String(text).includes('вышли')
        );

        expect(logoutCall).toBeTruthy();
        expect(logoutCall[2].reply_markup.keyboard).toEqual(expect.any(Array));
    });

    test('my_chat_member reports blocked and unblocked state changes', async () => {
        await fakeBot.emitEvent('my_chat_member', {
            chat: { id: 1001 },
            new_chat_member: { status: 'kicked' }
        });
        await fakeBot.emitEvent('my_chat_member', {
            chat: { id: 1001 },
            new_chat_member: { status: 'member' }
        });

        expect(axiosMock.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/bot/activity'),
            { chatId: '1001', isBlocked: true },
            expect.any(Object)
        );
        expect(axiosMock.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/bot/activity'),
            { chatId: '1001', isBlocked: false },
            expect.any(Object)
        );
    });

    test('nb cron sends absence notifications using user language', async () => {
        axiosMock.post.mockImplementation((url) => {
            if (url.includes('/api/bot/check-new-absences')) {
                return Promise.resolve({
                    data: {
                        notifications: [
                            {
                                chatId: '1001',
                                diff: 2,
                                total: 5,
                                latestSubject: 'Physics',
                                latestDate: Math.floor(new Date('2026-03-17T00:00:00.000Z').getTime() / 1000)
                            }
                        ]
                    }
                });
            }
            return Promise.resolve({ data: { success: true } });
        });
        axiosMock.get.mockImplementation((url) => {
            if (url.includes('/api/bot/language/1001')) {
                return Promise.resolve({ data: { language: 'uz-UZ' } });
            }
            return Promise.resolve({ data: {} });
        });

        await fakeCron.jobs[2].handler();

        expect(fakeBot.sendMessage).toHaveBeenCalledWith(
            '1001',
            expect.stringContaining(i18n.t('uz-UZ', 'newAbsenceWarning')),
            { parse_mode: 'HTML' }
        );
        expect(fakeBot.sendMessage).toHaveBeenCalledWith(
            '1001',
            expect.stringContaining('Physics'),
            { parse_mode: 'HTML' }
        );
    });

    test('nb cron reports unavailable chat back to backend', async () => {
        axiosMock.post.mockImplementation((url) => {
            if (url.includes('/api/bot/check-new-absences')) {
                return Promise.resolve({
                    data: {
                        notifications: [
                            {
                                chatId: '1001',
                                diff: 1,
                                total: 3,
                                latestSubject: 'Physics',
                                latestDate: Math.floor(new Date('2026-03-17T00:00:00.000Z').getTime() / 1000)
                            }
                        ]
                    }
                });
            }

            return Promise.resolve({ data: { success: true } });
        });
        axiosMock.get.mockImplementation((url) => {
            if (url.includes('/api/bot/language/1001')) {
                return Promise.resolve({ data: { language: 'ru-RU' } });
            }

            return Promise.resolve({ data: {} });
        });
        fakeBot.sendMessage.mockRejectedValueOnce(new Error('ETELEGRAM: 400 Bad Request: chat not found'));

        await fakeCron.jobs[2].handler();

        expect(axiosMock.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/bot/delivery-failed'),
            { chatId: '1001', chatType: 'private' },
            expect.any(Object)
        );
    });
});
