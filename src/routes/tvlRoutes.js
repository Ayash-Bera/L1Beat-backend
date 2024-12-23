const express = require('express');
const router = express.Router();
const tvlController = require('../controllers/tvlController');
const tvlService = require('../services/tvlService');
const TVL = require('../models/tvl');

router.get('/tvl/history', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const data = await tvlService.getTvlHistory(days);
    res.json(data);  // Return array directly
  } catch (error) {
    console.error('TVL History Error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch TVL data'
    });
  }
});

// Simple version without API key
if (process.env.NODE_ENV === 'development') {
  router.post('/tvl/update', async (req, res) => {
    try {
      await tvlService.updateTvlData();
      res.json({ success: true, message: 'TVL data updated successfully' });
    } catch (error) {
      console.error('Manual TVL update failed:', error);
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
      console.error('Failed to update TVL data during health check:', error);
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
    console.error('TVL health check error:', error);
    res.status(500).json({ 
      error: error.message,
      status: 'error',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router; 