const i18n = require('./i18n');

function getLocale(language) {
    return language === 'uz-UZ' ? 'uz-UZ' : 'ru-RU';
}

function formatAttendanceMessage(attendanceData, language) {
    const { totalHours, justifiedHours, unjustifiedHours, subjects } = attendanceData;
    const locale = getLocale(language);

    let text = `📊 <b>${i18n.t(language, 'myAttendance')}</b>\n`;
    text += `══════════════════\n`;
    text += `🔴 <b>${i18n.t(language, 'totalAbsent')}:</b> ${totalHours} ${i18n.t(language, 'hours')}\n`;
    text += `❌ ${i18n.t(language, 'withoutReason')}: <b>${unjustifiedHours} ${i18n.t(language, 'hours')}</b>\n`;
    text += `🟢 ${i18n.t(language, 'withReason')}: <b>${justifiedHours} ${i18n.t(language, 'hours')}</b>\n\n`;

    if (subjects.length > 0) {
        subjects.forEach((subject) => {
            text += `📚 <b>${subject.name}</b> (${subject.totalSubjectHours} ${i18n.t(language, 'hours')})\n`;

            subject.details.forEach((detail) => {
                const dateObj = new Date(detail.date * 1000);
                const dateStr = dateObj.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
                const statusIcon = detail.isJustified ? '🟢' : '❌';

                text += `   ▪️ ${dateStr} ${detail.time} — ${detail.hours}${i18n.t(language, 'hours')} (${statusIcon})\n`;
            });
            text += `\n`;
        });
    } else {
        text += `✅ <b>${i18n.t(language, 'congratulations')}</b> ${i18n.t(language, 'noAbsences')}`;
    }

    return `${text}\n👉 @HEMISnotify_bot`;
}

function formatProfileMessage(user, language) {
    let text = `<b>👤 ${i18n.t(language, 'yourProfile')}:</b>\n\n`;
    text += `📛 <b>${i18n.t(language, 'fullName')}:</b> ${user.fullName}\n`;
    text += `🆔 <b>${i18n.t(language, 'login')}:</b> ${user.hemisLogin}\n`;
    text += `🏫 <b>${i18n.t(language, 'groupLabel')}:</b> ${user.group || i18n.t(language, 'notSpecified')}\n`;
    text += `🎓 <b>${i18n.t(language, 'role')}:</b> ${user.role === 'student' ? i18n.t(language, 'student') : i18n.t(language, 'teacher')}`;
    text += `\n\n👉 @HEMISnotify_bot`;

    return text;
}

function formatNbNotification(notification, language) {
    const locale = getLocale(language);
    let text = `⚠️ <b>${i18n.t(language, 'newAbsenceWarning')}</b>\n\n`;

    if (notification.latestSubject) {
        const dateObj = new Date(notification.latestDate * 1000);
        const dateStr = dateObj.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
        text += `📚 <b>${i18n.t(language, 'subject')}:</b> ${notification.latestSubject}\n`;
        text += `📅 <b>${i18n.t(language, 'date')}:</b> ${dateStr}\n`;
    }

    text += `📈 <b>${i18n.t(language, 'added')}:</b> +${notification.diff} ${i18n.t(language, 'hours')}\n`;
    text += `🔴 <b>${i18n.t(language, 'totalAbsences')}:</b> ${notification.total} ${i18n.t(language, 'hours')}\n\n`;
    text += `<i>${i18n.t(language, 'checkDetails')}</i>`;
    text += `\n\n👉 @HEMISnotify_bot`;

    return text;
}

function getLogoutMessage(language) {
    return language === 'uz-UZ' ? 'Tizimdan chiqdingiz.' : 'Вы вышли из системы.';
}

module.exports = {
    formatAttendanceMessage,
    formatProfileMessage,
    formatNbNotification,
    getLogoutMessage
};
