// Backend/utils/crypto.js

const crypto = require('crypto');

const algorithm = 'aes-256-cbc';
const key = process.env.ENCRYPTION_KEY; // 32-байтный ключ из .env

// Добавить проверку
if (!key || key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 bytes (256 bits)');
}

// Функция шифрования
function encrypt(text) {
    if (!text) return null;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, Buffer.from(key), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// Функция расшифровки
function decrypt(text) {
    if (!text) return null;
    // Проверяем, зашифрован ли пароль (содержит ли разделитель ':')
    // Это обеспечивает обратную совместимость со старыми, незашифрованными паролями.
    if (!text.includes(':')) {
        return text; // Если разделителя нет, возвращаем как есть
    }
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(algorithm, Buffer.from(key), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

module.exports = { encrypt, decrypt };