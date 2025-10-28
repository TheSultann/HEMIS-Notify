const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['student', 'teacher'], required: true },
    group: { type: String },
    hemisToken: { type: String },
    hemisLogin: { type: String },
    hemisPassword: { type: String },
    telegramChatId: { type: String, unique: true, sparse: true } 
}, { timestamps: true });

// Хэширование пароля перед сохранением
UserSchema.pre('save', async function (next) {
    if (!this.isModified('passwordHash')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    next();
});

// Метод для сравнения паролей
UserSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.passwordHash);
};

module.exports = mongoose.model('User', UserSchema);