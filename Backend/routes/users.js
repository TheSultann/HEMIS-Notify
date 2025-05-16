const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

// GET /api/user/me
router.get('/me', protect, (req, res) => {
    // req.user устанавливается в protect middleware
    res.json(req.user);
});

module.exports = router;
