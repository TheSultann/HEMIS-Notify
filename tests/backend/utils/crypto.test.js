describe('crypto utils', () => {
    const validKey = '12345678901234567890123456789012';

    afterEach(() => {
        process.env.ENCRYPTION_KEY = validKey;
        jest.resetModules();
    });

    test('encrypts and decrypts value round-trip', () => {
        const { encrypt, decrypt } = require('../../../Backend/utils/crypto');
        const encrypted = encrypt('super-secret');

        expect(encrypted).not.toBe('super-secret');
        expect(decrypt(encrypted)).toBe('super-secret');
    });

    test('returns null when encrypting or decrypting nullish values', () => {
        const { encrypt, decrypt } = require('../../../Backend/utils/crypto');

        expect(encrypt(null)).toBeNull();
        expect(decrypt(null)).toBeNull();
    });

    test('keeps legacy plain-text password compatible on decrypt', () => {
        const { decrypt } = require('../../../Backend/utils/crypto');

        expect(decrypt('legacy-plain-password')).toBe('legacy-plain-password');
    });

    test('throws on invalid encryption key length during module load', () => {
        process.env.ENCRYPTION_KEY = 'short-key';
        jest.resetModules();

        expect(() => require('../../../Backend/utils/crypto')).toThrow('ENCRYPTION_KEY must be exactly 32 bytes');
    });
});
