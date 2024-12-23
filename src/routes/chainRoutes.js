const express = require('express');
const router = express.Router();
const chainController = require('../controllers/chainController');

// Add error handling wrapper
const asyncHandler = fn => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(next);
};

// Get all chains
router.get('/chains', async (req, res) => {
  try {
    await chainController.getAllChains(req, res);
  } catch (error) {
    console.error('Chain route error:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get single chain
router.get('/chains/:chainId', asyncHandler(async (req, res) => {
  try {
    const chain = await chainController.getChainById(req.params.chainId);
    if (!chain) {
      return res.status(404).json({
        success: false,
        error: 'Chain not found'
      });
    }
    res.json({
      success: true,
      data: chain
    });
  } catch (error) {
    console.error('Error fetching chain:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chain'
    });
  }
}));

router.get('/chains/:chainId/validators', asyncHandler(chainController.getChainValidators));

// Add OPTIONS handling for CORS preflight
router.options('*', (req, res) => {
  res.status(200).end();
});

module.exports = router;
