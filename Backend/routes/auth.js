const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const validator = require('validator');
require('dotenv').config();

const HEMIS_API_BASE = process.env.HEMIS_API_BASE;

// Заглушки для кэширования токена
const getCachedToken = async (userId) => {
    const user = await User.findById(userId);
    return user?.hemisToken || null;
};

const saveToken = async (userId, token) => {
    try {
        const updatedUser = await User.findByIdAndUpdate(userId, { hemisToken: token }, { new: true });
        if (!updatedUser) {
            console.error('Failed to update user with HEMIS token for userId:', userId);
            return false;
        }
        console.log('HEMIS token saved for user:', userId, 'Token:', token);
        return true;
    } catch (error) {
        console.error('Error saving HEMIS token:', error);
        return false;
    }
};

// Функция для авторизации в HEMIS API с задержкой
async function loginToHemis(hemisLogin, hemisPassword, userId) {
    const cachedToken = await getCachedToken(userId);
    if (cachedToken) {
        console.log('Using cached HEMIS token:', cachedToken);
        return cachedToken;
    }

    const endpoint = "/v1/auth/login";
    const url = `${HEMIS_API_BASE}${endpoint}`;

    if (!hemisLogin || !hemisPassword) {
        console.log('HEMIS login or password missing');
        return null;
    }

    const loginData = {
        login: hemisLogin,
        password: hemisPassword
    };

    try {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Задержка для лимита

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(loginData)
        });

        console.log('HEMIS API Response Status:', response.status);
        console.log('HEMIS API Response Headers:', [...response.headers.entries()]);

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.log('HEMIS API Response (non-JSON):', text);
            throw new Error('Expected JSON, but received non-JSON response');
        }

        const data = await response.json();

        if (!data.success || !data.data?.token) {
            console.log('Failed to get HEMIS token:', data);
            return null;
        }

        const token = data.data.token;
        const saved = await saveToken(userId, token);
        if (!saved) {
            console.log('Failed to save HEMIS token to database');
            return null;
        }
        console.log('New HEMIS token received:', token);

        return token;
    } catch (error) {
        console.error('Login to HEMIS failed:', error);
        return null;
    }
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
    const { name, email, password, role, group, hemisLogin, hemisPassword } = req.body;

    if (!name || !email || !password || !role || !hemisLogin || !hemisPassword) {
        return res.status(400).json({ message: 'Please fill all required fields, including HEMIS login and password' });
    }
    if (!validator.isEmail(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
    }
    if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    if (role === 'student' && !group) {
        return res.status(400).json({ message: 'Group is required for students' });
    }

    try {
        const userExists = await User.findOne({ email });
        if (userExists) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const user = new User({
            name,
            email,
            passwordHash: password,
            role,
            group: role === 'student' ? group : undefined,
            hemisLogin,
            hemisPassword // Сохраняем пароль для повторной авторизации
        });
        await user.save();

        const hemisToken = await loginToHemis(hemisLogin, hemisPassword, user._id);
        if (!hemisToken) {
            return res.status(400).json({ message: 'Failed to authenticate with HEMIS API' });
        }

        user.hemisToken = hemisToken;
        await user.save();

        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });

        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            group: user.group,
            token,
            hemisToken
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Please provide email and password' });
    }
    try {
        const user = await User.findOne({ email });
        if (user && (await user.matchPassword(password))) {
            const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
            res.json({
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                group: user.group,
                token,
                hemisToken: user.hemisToken
            });
        } else {
            res.status(401).json({ message: 'Invalid email or password' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;