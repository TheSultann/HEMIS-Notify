const express = require('express');
const hemisService = require('../services/hemisService');

const router = express.Router();

router.scheduleService = hemisService;

module.exports = router;
