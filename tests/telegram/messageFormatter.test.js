const {
    formatAttendanceMessage,
    formatProfileMessage,
    formatNbNotification,
    getLogoutMessage
} = require('../../TelegramBot/messageFormatter');
const i18n = require('../../TelegramBot/i18n');

describe('Telegram message formatter', () => {
    test('formats attendance summary with subject details', () => {
        const text = formatAttendanceMessage({
            totalHours: 4,
            justifiedHours: 1,
            unjustifiedHours: 3,
            subjects: [
                {
                    name: 'Math',
                    totalSubjectHours: 4,
                    details: [
                        {
                            date: Math.floor(new Date('2026-03-17T00:00:00.000Z').getTime() / 1000),
                            time: '08:30',
                            hours: 2,
                            isJustified: false
                        }
                    ]
                }
            ]
        }, 'ru-RU');

        expect(text).toContain(i18n.t('ru-RU', 'myAttendance'));
        expect(text).toContain('Math');
        expect(text).toContain('08:30');
        expect(text).toContain('@HEMISnotify_bot');
    });

    test('formats attendance summary without subjects as no-absence message', () => {
        const text = formatAttendanceMessage({
            totalHours: 0,
            justifiedHours: 0,
            unjustifiedHours: 0,
            subjects: []
        }, 'uz-UZ');

        expect(text).toContain(i18n.t('uz-UZ', 'congratulations'));
        expect(text).toContain(i18n.t('uz-UZ', 'noAbsences'));
    });

    test('formats profile message with translated role and fallback group label', () => {
        const text = formatProfileMessage({
            fullName: 'Student One',
            hemisLogin: 's1001',
            group: '',
            role: 'student'
        }, 'ru-RU');

        expect(text).toContain('Student One');
        expect(text).toContain('s1001');
        expect(text).toContain(i18n.t('ru-RU', 'notSpecified'));
        expect(text).toContain(i18n.t('ru-RU', 'student'));
    });

    test('formats NB notification with subject/date details', () => {
        const text = formatNbNotification({
            diff: 2,
            total: 5,
            latestSubject: 'Physics',
            latestDate: Math.floor(new Date('2026-03-17T00:00:00.000Z').getTime() / 1000)
        }, 'uz-UZ');

        expect(text).toContain(i18n.t('uz-UZ', 'newAbsenceWarning'));
        expect(text).toContain('Physics');
        expect(text).toContain(i18n.t('uz-UZ', 'added'));
        expect(text).toContain('@HEMISnotify_bot');
    });

    test('returns localized logout message', () => {
        expect(getLogoutMessage('ru-RU')).toBe('Вы вышли из системы.');
        expect(getLogoutMessage('uz-UZ')).toBe('Tizimdan chiqdingiz.');
    });
});
