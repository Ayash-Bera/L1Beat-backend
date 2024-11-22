const axios = require('axios');
const chainService = require('../services/chainService');
const tvlService = require('../services/tvlService');

const fetchAndUpdateData = async () => {
  try {
    console.log('Starting scheduled data update...');
    
    // Update chains
    const response = await axios.get('https://glacier-api.avax.network/v1/chains');
    const chains = response.data.chains;

    for (const chain of chains) {
      await chainService.updateChain(chain);
    }
    
    // Update TVL data
    await tvlService.updateTvlData();
    
    console.log('Chains and TVL data updated successfully');
  } catch (error) {
    console.error('Error in scheduled data update:', error);
  }
};

// Schedule updates every 30 minutes
setInterval(fetchAndUpdateData, 30 * 60 * 1000);

// Initial fetch when server starts
fetchAndUpdateData();

module.exports = fetchAndUpdateData;
