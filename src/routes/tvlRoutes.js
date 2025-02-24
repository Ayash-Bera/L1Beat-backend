const express = require('express');
const router = express.Router();
const tvlController = require('../controllers/tvlController');
const tvlService = require('../services/tvlService');
const TVL = require('../models/tvl');
const { validate, validators } = require('../utils/validationMiddleware');
const logger = require('../utils/logger');
const config = require('../config/config');

router.get('/tvl/history', validate(validators.getTvlHistory), tvlController.getTvlHistory);

// Add new route for latest TVL
router.get('/tvl/latest', async (req, res) => {
  try {
    const latestTVL = await TVL.findOne().sort({ date: -1 }).lean();
    
    if (!latestTVL) {
      return res.status(404).json({
        success: false,
        error: 'No TVL data available'
      });
    }
    
    res.json({
      success: true,
      data: {
        tvl: latestTVL.tvl,
        date: latestTVL.date,
        timestamp: new Date(latestTVL.date * 1000).toISOString()
      },
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Latest TVL Error:', { error: error.message });
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Simple version without API key
if (config.isDevelopment) {
  router.post('/tvl/update', async (req, res) => {
    try {
      await tvlService.updateTvlData();
      res.json({ success: true, message: 'TVL data updated successfully' });
    } catch (error) {
      logger.error('Manual TVL update failed:', { error: error.message });
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });
}

router.get('/tvl/health', async (req, res) => {
  try {
    // Always try to update data first
    await tvlService.updateTvlData().catch(error => {
      logger.error('Failed to update TVL data during health check:', { error: error.message });
    });

    const currentTime = Math.floor(Date.now() / 1000);
    const latestTVL = await TVL.findOne().sort({ date: -1 });
    
    if (!latestTVL) {
      return res.status(500).json({
        error: 'No TVL data available',
        status: 'error',
        timestamp: new Date().toISOString()
      });
    }

    const ageInHours = (currentTime - latestTVL.date) / 3600;

    res.json({
      lastUpdate: new Date(latestTVL.date * 1000).toISOString(),
      ageInHours: ageInHours.toFixed(2),
      tvl: latestTVL.tvl,
      status: ageInHours < 24 ? 'healthy' : 'stale',
      currentTime: new Date(currentTime * 1000).toISOString()
    });

  } catch (error) {
    logger.error('TVL health check error:', { error: error.message });
    res.status(500).json({ 
      error: error.message,
      status: 'error',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router; 