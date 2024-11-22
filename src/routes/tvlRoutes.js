const express = require('express');
const router = express.Router();
const tvlController = require('../controllers/tvlController');
const tvlService = require('../services/tvlService');

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

module.exports = router; 