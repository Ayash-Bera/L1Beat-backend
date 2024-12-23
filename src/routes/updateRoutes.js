const express = require('express');
const router = express.Router();
const Chain = require('../models/chain');
const tpsService = require('../services/tpsService');
const tvlService = require('../services/tvlService');
const fetchAndUpdateData = require('../utils/fetchGlacierData');
const mongoose = require('mongoose');

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
    // Simple DB connection check
    const isConnected = mongoose.connection.readyState === 1;
    
    if (!isConnected) {
      throw new Error('Database not connected');
    }

    // Quick count of chains instead of fetching all data
    const chainCount = await Chain.countDocuments();

    res.json({
      success: true,
      status: 'ok',
      timestamp: new Date().toISOString(),
      metrics: {
        totalChains: chainCount,
        dbConnected: isConnected
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

// Test endpoint - make it super lightweight
router.get('/test', validateApiKey, (req, res) => {
  try {
    // Remove async/await since we don't need it
    // Return minimal response
    res.status(200).json({
      success: true,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Test endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error'
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