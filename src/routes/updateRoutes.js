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

// Batch update endpoint
router.post('/update/batch', validateApiKey, async (req, res) => {
  try {
    console.log('Starting batch update...');
    const startTime = Date.now();
    
    // Get all chains
    const chains = await Chain.find().select('chainId');
    const results = [];

    // Update TPS for each chain
    for (const chain of chains) {
      try {
        await tpsService.updateTpsData(chain.chainId);
        const latestTps = await tpsService.getLatestTps(chain.chainId);
        results.push({
          chainId: chain.chainId,
          success: true,
          latestTps
        });
      } catch (error) {
        console.error(`Failed to update chain ${chain.chainId}:`, error);
        results.push({
          chainId: chain.chainId,
          success: false,
          error: error.message
        });
      }
    }

    // Update TVL
    try {
      await tvlService.updateTvlData();
      results.push({
        type: 'tvl',
        success: true
      });
    } catch (error) {
      results.push({
        type: 'tvl',
        success: false,
        error: error.message
      });
    }

    const duration = (Date.now() - startTime) / 1000;
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      duration: `${duration.toFixed(2)}s`,
      results
    });
  } catch (error) {
    console.error('Batch update failed:', error);
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