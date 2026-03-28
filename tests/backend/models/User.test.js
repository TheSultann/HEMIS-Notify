const User = require('../../../Backend/models/User');

function createValidUser(overrides = {}) {
    return new User({
        hemisLogin: `user-${Math.random()}`,
        hemisPassword: 'secret',
        ...overrides
    });
}

describe('User model language normalization', () => {
    test('normalizes short Russian code to ru-RU', async () => {
        const user = createValidUser({ language: 'ru' });
        await user.validate();
        expect(user.language).toBe('ru-RU');
    });

    test('normalizes short Uzbek code to uz-UZ', async () => {
        const user = createValidUser({ language: 'uz' });
        await user.validate();
        expect(user.language).toBe('uz-UZ');
    });

    test('falls back to ru-RU for unsupported language code', async () => {
        const user = createValidUser({ language: 'de-DE' });
        await user.validate();
        expect(user.language).toBe('ru-RU');
    });

    test('keeps null language untouched', async () => {
        const user = createValidUser({ language: null });
        await user.validate();
        expect(user.language).toBeNull();
    });
});
