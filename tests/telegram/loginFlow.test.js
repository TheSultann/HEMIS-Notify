const {
    createLoginStart,
    advanceLoginState,
    buildRegistrationPayload
} = require('../../TelegramBot/loginFlow');

describe('Telegram login flow helper', () => {
    test('allows login flow only in private chats', () => {
        expect(createLoginStart('private')).toEqual({
            type: 'await_login',
            nextState: 'awaiting_hemis_login'
        });

        expect(createLoginStart('group')).toEqual({
            type: 'private_only'
        });
    });

    test('moves from login state to password state and stores login', () => {
        expect(advanceLoginState('awaiting_hemis_login', 'S12345')).toEqual({
            nextState: 'awaiting_hemis_password',
            hemisLogin: 'S12345'
        });
    });

    test('returns null for unsupported state transition', () => {
        expect(advanceLoginState('awaiting_broadcast_text', 'S12345')).toBeNull();
    });

    test('builds registration payload with string chat id', () => {
        expect(buildRegistrationPayload(1001, 'S12345', 'secret')).toEqual({
            hemisLogin: 'S12345',
            hemisPassword: 'secret',
            chatId: '1001'
        });
    });
});
