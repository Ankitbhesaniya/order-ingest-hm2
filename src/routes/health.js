const express = require('express');
const { checkHealth, getMetrics } = require('../controllers/healthController');

const router = express.Router();

router.get('/health', checkHealth);
router.get('/metrics', getMetrics);

module.exports = router;
