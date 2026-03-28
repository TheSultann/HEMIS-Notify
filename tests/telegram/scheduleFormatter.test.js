const { filterScheduleByDate, formatSchedule } = require('../../TelegramBot/scheduleFormatter');

describe('scheduleFormatter', () => {
    test('filterScheduleByDate returns only entries for requested date', () => {
        const targetDate = new Date('2026-03-17T10:00:00+05:00');
        const schedule = [
            { lesson_date: Math.floor(new Date('2026-03-17T08:00:00+05:00').getTime() / 1000) },
            { lesson_date: Math.floor(new Date('2026-03-18T08:00:00+05:00').getTime() / 1000) }
        ];

        expect(filterScheduleByDate(schedule, targetDate)).toHaveLength(1);
    });

    test('formatSchedule renders empty-day message', () => {
        const message = formatSchedule([], 'student', new Date('2026-03-17T10:00:00+05:00'), 'SE-101', 'ru-RU');

        expect(message).toContain('SE-101');
        expect(message).toContain('👉 @HEMISnotify_bot');
    });

    test('formatSchedule renders teacher and classroom details', () => {
        const message = formatSchedule([
            {
                time: '08:30',
                subjectId: {
                    name: 'Math',
                    teacherName: 'Teacher',
                    groupName: 'SE-101',
                    auditoriumName: 'A-1',
                    lessonType: 'Lecture'
                }
            }
        ], 'student', new Date('2026-03-17T10:00:00+05:00'), 'SE-101', 'ru-RU');

        expect(message).toContain('Math');
        expect(message).toContain('Teacher');
        expect(message).toContain('A-1');
        expect(message).toContain('Lecture');
        expect(message).toContain('1-пара · 08:30');
    });

    test('formatSchedule renders teacher perspective with group label when no outer group name is provided', () => {
        const message = formatSchedule([
            {
                time: '10:00',
                subjectId: {
                    name: 'Physics',
                    teacherName: 'Teacher',
                    groupName: 'SE-201',
                    auditoriumName: 'B-2',
                    lessonType: ''
                }
            }
        ], 'teacher', new Date('2026-03-17T10:00:00+05:00'), '', 'ru-RU');

        expect(message).toContain('Physics');
        expect(message).toContain('SE-201');
        expect(message).toContain('B-2');
    });

    test('formatSchedule uses shift-aware pair numbers for afternoon lessons', () => {
        const message = formatSchedule([
            {
                time: '14:00',
                subjectId: {
                    name: 'Data Mining',
                    teacherName: 'Teacher One',
                    groupName: 'SE-101',
                    auditoriumName: '206',
                    lessonType: 'Lecture'
                }
            },
            {
                time: '15:30',
                subjectId: {
                    name: 'Individual Project',
                    teacherName: 'Teacher Two',
                    groupName: 'SE-101',
                    auditoriumName: '206',
                    lessonType: 'Practice'
                }
            }
        ], 'student', new Date('2026-03-19T10:00:00+05:00'), '915-23 KII', 'ru-RU');

        expect(message).toContain('2-пара · 14:00');
        expect(message).toContain('3-пара · 15:30');
        expect(message).toContain('🚪 206\n\n━ 3-пара');
    });
});
