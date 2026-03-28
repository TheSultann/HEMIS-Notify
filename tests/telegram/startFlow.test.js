const { resolveStartFlow } = require('../../TelegramBot/startFlow');

describe('Telegram start flow resolver', () => {
    test('returns group greeting flow for non-private chats', () => {
        expect(resolveStartFlow({
            chatType: 'group',
            language: 'uz-UZ'
        })).toEqual({
            type: 'group_greeting',
            language: 'uz-UZ'
        });
    });

    test('returns language selection when language is missing', () => {
        expect(resolveStartFlow({
            chatType: 'private',
            language: null,
            isAdmin: false,
            hasSchedule: false
        })).toEqual({
            type: 'select_language',
            language: 'ru-RU'
        });
    });

    test('returns admin welcome flow for registered admin user', () => {
        expect(resolveStartFlow({
            chatType: 'private',
            language: 'ru-RU',
            isAdmin: true,
            hasSchedule: true
        })).toEqual({
            type: 'welcome_back',
            language: 'ru-RU',
            menuType: 'admin'
        });
    });

    test('returns onboarding flow for user without schedule access', () => {
        expect(resolveStartFlow({
            chatType: 'private',
            language: 'uz-UZ',
            isAdmin: false,
            hasSchedule: false
        })).toEqual({
            type: 'onboarding',
            language: 'uz-UZ',
            nextState: 'awaiting_hemis_login'
        });
    });

    test('falls back to language selection when lookup failed', () => {
        expect(resolveStartFlow({
            chatType: 'private',
            languageLookupFailed: true
        })).toEqual({
            type: 'select_language',
            language: 'ru-RU'
        });
    });
});
