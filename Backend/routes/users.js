const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

// GET /api/user/me
router.get('/me', protect, (req, res) => {
    // req.user устанавливается в protect middleware
    res.json({
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        group: req.user.group,
        hemisToken: req.user.hemisToken,
        hemisLogin: req.user.hemisLogin
    });
});

module.exports = router;