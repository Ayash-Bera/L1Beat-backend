const express = require('express');
const router = express.Router();
const tpsService = require('../services/tpsService');

// Get TPS history for a chain
router.get('/chains/:chainId/tps/history', async (req, res) => {
  try {
    const { chainId } = req.params;
    const days = parseInt(req.query.days) || 30;
    const data = await tpsService.getTpsHistory(chainId, days);
    res.json({
      success: true,
      chainId,
      count: data.length,
      data
    });
  } catch (error) {
    console.error('TPS History Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get latest TPS for a chain
router.get('/chains/:chainId/tps/latest', async (req, res) => {
  try {
    const { chainId } = req.params;
    const data = await tpsService.getLatestTps(chainId);
    res.json({
      success: true,
      chainId,
      data,
      timestamp: data ? new Date(data.timestamp * 1000).toISOString() : null
    });
  } catch (error) {
    console.error('Latest TPS Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Force update TPS data (development only)
if (process.env.NODE_ENV === 'development') {
  router.post('/chains/:chainId/tps/update', async (req, res) => {
    try {
      const { chainId } = req.params;
      await tpsService.updateTpsData(chainId);
      const latest = await tpsService.getLatestTps(chainId);
      res.json({
        success: true,
        message: 'TPS data updated successfully',
        latest
      });
    } catch (error) {
      console.error('TPS Update Error:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });
}

// Add new route for total network TPS
router.get('/tps/network/latest', async (req, res) => {
  try {
    const data = await tpsService.getNetworkTps();
    res.json({
      success: true,
      data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Network TPS Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Add new route for historical network TPS
router.get('/tps/network/history', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const data = await tpsService.getNetworkTpsHistory(days);
    res.json({
      success: true,
      data,
      count: data.length,
      period: `${days} days`
    });
  } catch (error) {
    console.error('Network TPS History Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router; 