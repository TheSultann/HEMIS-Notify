const keyboards = require('../../TelegramBot/keyboards');

describe('Telegram keyboards', () => {
    test('schedule pagination adds colors only for schedule navigation inline buttons', () => {
        const keyboard = keyboards.getSchedulePagination(new Date(2026, 2, 28), 'ru-RU');
        const [backButton, forwardButton] = keyboard.reply_markup.inline_keyboard[0];

        expect(backButton).toMatchObject({
            text: '⬅️ Назад',
            callback_data: 'sched_2026-03-27',
            style: 'primary'
        });

        expect(forwardButton).toMatchObject({
            text: 'Вперед ➡️',
            callback_data: 'sched_2026-03-29',
            style: 'primary'
        });
    });

    test('onboarding keyboard renders a single primary start button', () => {
        const keyboard = keyboards.getOnboardingStartKeyboard('uz-UZ');
        const [startButton] = keyboard.reply_markup.inline_keyboard[0];

        expect(startButton).toMatchObject({
            text: "Tushunarli, boshlash",
            callback_data: 'onboarding_start',
            style: 'primary'
        });
    });
});
