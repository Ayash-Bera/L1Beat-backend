const express = require('express');
const router = express.Router();
const teleporterController = require('../controllers/teleporterController');
const { validate, validators } = require('../utils/validationMiddleware');

/**
 * @route   GET /api/teleporter/messages/daily-count
 * @desc    Get daily cross-chain message count
 * @access  Public
 */
router.get('/teleporter/messages/daily-count', 
  validate(validators.getDailyCrossChainMessageCount), 
  teleporterController.getDailyCrossChainMessageCount
);

/**
 * @route   GET /api/teleporter/messages/weekly-count
 * @desc    Get weekly cross-chain message count (last 7 days)
 * @access  Public
 */
router.get('/teleporter/messages/weekly-count', 
  validate(validators.getWeeklyCrossChainMessageCount), 
  teleporterController.getWeeklyCrossChainMessageCount
);

/**
 * @route   GET /api/teleporter/messages/historical-daily
 * @desc    Get historical daily cross-chain message counts for the past N days
 * @access  Public
 */
router.get('/teleporter/messages/historical-daily',
  validate(validators.getHistoricalDailyData),
  teleporterController.getHistoricalDailyData
);

module.exports = router; 