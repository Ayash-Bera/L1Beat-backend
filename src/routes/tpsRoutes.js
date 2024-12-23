const express = require('express');
const router = express.Router();
const tpsService = require('../services/tpsService');

// Get TPS history for a chain
router.get('/chains/:chainId/tps/history', async (req, res) => {
  try {
    const { chainId } = req.params;
    const days = parseInt(req.query.days) || 30;
    const response = await tpsService.getTpsHistory(chainId, days);
    
    // Add caching headers
    res.set('Cache-Control', 'public, max-age=300');
    res.json(response);
  } catch (error) {
    console.error('TPS History Error:', {
      chainId,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch TPS data',
      data: []
    });
  }
});

// Get latest TPS for a chain
router.get('/chains/:chainId/tps/latest', async (req, res) => {
  const startTime = Date.now();
  try {
    const { chainId } = req.params;
    
    // Set a timeout for the request
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), 5000);
    });

    const dataPromise = tpsService.getLatestTps(chainId);
    const response = await Promise.race([dataPromise, timeoutPromise]);

    const responseTime = Date.now() - startTime;
    console.log(`TPS request for chain ${chainId} completed in ${responseTime}ms:`, response);

    // Add caching headers
    res.set('Cache-Control', 'public, max-age=60');
    res.json(response);
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error('Latest TPS Error:', {
      error: error.message,
      duration: responseTime,
      chainId: req.params.chainId
    });

    // Return a more graceful error for timeouts
    if (error.message === 'Request timeout') {
      return res.status(504).json({
        success: false,
        error: 'Request timed out',
        data: {
          value: null,
          timestamp: null
        }
      });
    }

    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch TPS data',
      data: {
        value: null,
        timestamp: null
      }
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

// Get network TPS
router.get('/tps/network/latest', async (req, res) => {
  try {
    const data = await tpsService.getNetworkTps();
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Network TPS Error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch TPS data'
    });
  }
});

// Get network TPS history
router.get('/tps/network/history', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const data = await tpsService.getNetworkTpsHistory(days);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(data);
  } catch (error) {
    console.error('Network TPS History Error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch TPS data'
    });
  }
});

module.exports = router; 