const express = require('express');
const router = express.Router();
const Chain = require('../models/chain');
const tpsService = require('../services/tpsService');
const tvlService = require('../services/tvlService');
const fetchAndUpdateData = require('../utils/fetchGlacierData');

// Middleware to check API key
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const validApiKey = process.env.UPDATE_API_KEY;

  if (!apiKey || apiKey !== validApiKey) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized"
    });
  }
  next();
};

// Update single chain TPS
router.post('/update/chain/:chainId/tps', validateApiKey, async (req, res) => {
  try {
    const { chainId } = req.params;
    await tpsService.updateTpsData(chainId);
    const latestTps = await tpsService.getLatestTps(chainId);
    
    res.json({
      success: true,
      chainId,
      latestTps
    });
  } catch (error) {
    console.error(`Failed to update chain ${chainId}:`, error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Update TVL
router.post('/update/tvl', validateApiKey, async (req, res) => {
  try {
    await tvlService.updateTvlData();
    res.json({
      success: true,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('TVL update failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Health check endpoint
router.get('/health', validateApiKey, async (req, res) => {
  try {
    const chains = await Chain.find().select('chainId tps');
    const currentTime = Math.floor(Date.now() / 1000);
    
    const staleChains = chains.filter(chain => {
      const dataAge = currentTime - (chain.tps?.timestamp || 0);
      return dataAge > 24 * 3600; // More than 24 hours old
    });

    // Return a simpler response format
    res.json({
      success: true,
      status: 'ok',
      timestamp: new Date().toISOString(),
      metrics: {
        totalChains: chains.length,
        staleChains: staleChains.length
      }
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      status: 'error'
    });
  }
});

// Test endpoint
router.get('/test', validateApiKey, async (req, res) => {
  try {
    // Simple response without any async operations
    return res.status(200).json({
      success: true,
      message: 'Test endpoint working',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Test endpoint error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error'
    });
  }
});

// Batch update endpoint
router.post('/update/batch', validateApiKey, async (req, res) => {
  try {
    // Start the update process but don't wait for it to complete
    res.json({
      success: true,
      message: 'Update process started',
      timestamp: new Date().toISOString()
    });

    // Continue processing in the background
    console.log('Starting batch update...');
    fetchAndUpdateData()
      .then(() => {
        console.log('Background update completed successfully');
      })
      .catch((error) => {
        console.error('Background update failed:', error);
      });

  } catch (error) {
    console.error('Batch update initiation failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router; 