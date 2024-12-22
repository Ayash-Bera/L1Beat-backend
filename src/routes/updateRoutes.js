const express = require('express');
const router = express.Router();
const Chain = require('../models/chain');
const tpsService = require('../services/tpsService');
const tvlService = require('../services/tvlService');

// Middleware to check API key
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!process.env.UPDATE_API_KEY || apiKey !== process.env.UPDATE_API_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
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

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalChains: chains.length,
      staleChains: staleChains.map(c => ({
        chainId: c.chainId,
        lastUpdate: new Date(c.tps?.timestamp * 1000).toISOString()
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router; 