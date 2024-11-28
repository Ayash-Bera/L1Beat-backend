const express = require('express');
const router = express.Router();
const tvlController = require('../controllers/tvlController');
const tvlService = require('../services/tvlService');
const TVL = require('../models/tvl');

router.get('/tvl/history', tvlController.getTvlHistory);

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
    const lastTVL = await TVL.findOne().sort({ date: -1 });
    const now = Date.now() / 1000;
    const lastUpdateAge = lastTVL ? now - lastTVL.date : null;
    
    res.json({
      lastUpdate: lastTVL ? new Date(lastTVL.date * 1000).toISOString() : null,
      ageInHours: lastUpdateAge ? (lastUpdateAge / 3600).toFixed(2) : null,
      tvl: lastTVL?.tvl,
      status: lastUpdateAge && lastUpdateAge < 86400 ? 'healthy' : 'stale'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 