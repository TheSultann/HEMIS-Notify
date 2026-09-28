// TelegramBot/keyboards.js

const i18n = require('./i18n');

function formatDateStr(date) {
    const d = new Date(date);
    let month = '' + (d.getMonth() + 1);
    let day = '' + d.getDate();
    const year = d.getFullYear();

    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;

    return [year, month, day].join('-');
}

module.exports = {
    getSchedulePagination: (currentDate, language = 'ru-RU') => {
        const prevDate = new Date(currentDate);
        prevDate.setDate(prevDate.getDate() - 1);

        const nextDate = new Date(currentDate);
        nextDate.setDate(nextDate.getDate() + 1);

        return {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: i18n.t(language, 'back'),
                            callback_data: `sched_${formatDateStr(prevDate)}`,
                            style: 'primary'
                        },
                        {
                            text: i18n.t(language, 'forward'),
                            callback_data: `sched_${formatDateStr(nextDate)}`,
                            style: 'primary'
                        }
                    ]
                ]
            }
        };
    },

    getLanguageSelectionKeyboard: () => {
        return {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🇷🇺 Русский', callback_data: 'lang_ru-RU' },
                        { text: '🇺🇿 O\'zbek', callback_data: 'lang_uz-UZ' }
                    ]
                ]
            }
        };
    },

    getOnboardingStartKeyboard: (language = 'ru-RU') => {
        return {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: i18n.t(language, 'startOnboarding'),
                            callback_data: 'onboarding_start',
                            style: 'primary'
                        }
                    ]
                ]
            }
        };
    },

    getMainMenu: (language = 'ru-RU') => {
        return {
            reply_markup: {
                keyboard: [
                    [i18n.t(language, 'lessons'), i18n.t(language, 'absences')],
                    [i18n.t(language, 'myProfile'), i18n.t(language, 'changeLanguage')]
                ],
                resize_keyboard: true
            }
        };
    },
    // ... после getMainMenu ...

    // ... (твои старые функции) ...

    getAdminMenu: (language = 'ru-RU') => {
        return {
            reply_markup: {
                keyboard: [
                    [i18n.t(language, 'lessons'), i18n.t(language, 'absences')],
                    [i18n.t(language, 'myProfile'), i18n.t(language, 'changeLanguage')],
                    ['📊 Статистика', '📢 Рассылка'] // Добавили кнопку рассылки
                ],
                resize_keyboard: true
            }
        };
    },

    // Выбор: кому отправляем?
    getBroadcastTargetKeyboard: () => {
        return {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '👤 Студентам', callback_data: 'bc_target_students' },
                        { text: '👥 Группам', callback_data: 'bc_target_groups' }
                    ],
                    [{ text: '❌ Отмена', callback_data: 'bc_cancel' }]
                ]
            }
        };
    },

    // Подтверждение: отправить или нет?
    getBroadcastConfirmKeyboard: () => {
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Отправить', callback_data: 'bc_send' }],
                    [{ text: '❌ Отмена', callback_data: 'bc_cancel' }]
                ]
            }
        };
    },

    // ... остальной код ...

    getLoginRetryKeyboard: (language = 'ru-RU') => {
        const isUz = language === 'uz-UZ';
        return {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: isUz ? '🔄 Loginni almashtirish' : '🔄 Сменить логин', callback_data: 'login_change_user' },
                        { text: isUz ? '❌ Bekor qilish' : '❌ Отмена', callback_data: 'login_cancel' }
                    ]
                ]
            }
        };
    },

    getGuestMenu: (language = 'ru-RU') => {
        return {
            reply_markup: {
                keyboard: [
                    [i18n.t(language, 'loginButton')]
                ],
                resize_keyboard: true
            }
        };
    },

    removeKeyboard: {
        reply_markup: {
            remove_keyboard: true
        }
    }
};
