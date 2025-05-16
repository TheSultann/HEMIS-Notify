const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const validator = require('validator');
require('dotenv').config();

// POST /api/auth/register
router.post('/register', async (req, res) => {
    const { name, email, password, role, group } = req.body;

    if (!name || !email || !password || !role) {
        return res.status(400).json({ message: 'Please fill all required fields' });
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
            passwordHash: password, // Хэширование произойдет в pre-save хуке
            role,
            group: role === 'student' ? group : undefined,
        });
        await user.save();

        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });

        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            group: user.group,
            token,
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
