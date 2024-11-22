const tvlService = require('../services/tvlService');

exports.getTvlHistory = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    console.log(`Requesting TVL history for ${days} days`);
    
    const tvlData = await tvlService.getTvlHistory(days);
    
    console.log(`Returning ${tvlData.length} TVL records`);
    res.json({
      success: true,
      count: tvlData.length,
      data: tvlData
    });
  } catch (error) {
    console.error('Error in getTvlHistory:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch TVL data',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}; 