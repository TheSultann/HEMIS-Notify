const i18n = require('./i18n');

const PAIR_NUMBER_BY_TIME = {
    '08:30': 1,
    '10:00': 2,
    '11:30': 3,
    '13:00': 1,
    '14:00': 2,
    '15:30': 3,
    '17:00': 4,
    '18:30': 5,
    '20:00': 6
};

function filterScheduleByDate(schedule, dateObject) {
    return (schedule || []).filter((item) => {
        const lessonDate = new Date(item.lesson_date * 1000);
        return lessonDate.getFullYear() === dateObject.getFullYear() &&
            lessonDate.getMonth() === dateObject.getMonth() &&
            lessonDate.getDate() === dateObject.getDate();
    });
}

function normalizeTime(time) {
    if (typeof time !== 'string') {
        return '';
    }

    const match = time.trim().match(/^(\d{1,2}):(\d{2})/);
    if (!match) {
        return '';
    }

    return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function resolvePairNumber(item, index) {
    const pairNumber = PAIR_NUMBER_BY_TIME[normalizeTime(item.time)];
    return pairNumber || index + 1;
}

function formatSchedule(schedule, role, dateObject, groupName, language = 'ru-RU') {
    const locale = language === 'uz-UZ' ? 'uz-UZ' : 'ru-RU';
    const dateStr = dateObject.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
    const weekday = dateObject.toLocaleDateString(locale, { weekday: 'long' });

    let message = `🗓️ <b>${weekday}, ${dateStr}</b>\n`;
    if (groupName) {
        message += `👥 <b>${i18n.t(language, 'group')}:</b> ${groupName}\n`;
    }
    message += '\n';

    if (!schedule || schedule.length === 0) {
        message += i18n.t(language, 'noLessons');
        message += '\n👉 @HEMISnotify_bot';
        return message;
    }

    [...schedule]
        .sort((left, right) => left.time.localeCompare(right.time))
        .forEach((item, index) => {
            const pairNumber = resolvePairNumber(item, index);
            message += `━ ${pairNumber}-${i18n.t(language, 'pair')} · ${item.time} ━━━━━━━━━━━\n`;
            message += `📚 <b>${item.subjectId.name}</b>\n`;
            if (item.subjectId.lessonType) {
                message += `🏷️ ${item.subjectId.lessonType}\n`;
            }

            if (role === 'teacher') {
                message += `👥 ${item.subjectId.groupName}\n`;
            } else {
                message += `👤 ${item.subjectId.teacherName}\n`;
            }

            message += `🚪 ${item.subjectId.auditoriumName}\n\n`;
        });

    message += `👉 @HEMISnotify_bot`;
    return message;
}

module.exports = {
    filterScheduleByDate,
    formatSchedule
};
