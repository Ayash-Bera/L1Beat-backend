const axios = require('axios');
const chainService = require('../services/chainService');
const tvlService = require('../services/tvlService');

const fetchAndUpdateData = async () => {
  try {
    console.log(`[${process.env.NODE_ENV}] Starting scheduled data update...`);
    
    // Update chains
    const response = await axios.get('https://glacier-api.avax.network/v1/chains');
    const chains = response.data.chains;

    for (const chain of chains) {
      await chainService.updateChain(chain);
    }
    
    // Update TVL data
    await tvlService.updateTvlData();
    
    console.log(`[${process.env.NODE_ENV}] Chains and TVL data updated successfully`);
  } catch (error) {
    console.error(`[${process.env.NODE_ENV}] Error in scheduled data update:`, error);
  }
};

// Remove the setInterval - we're using cron instead
module.exports = fetchAndUpdateData;
