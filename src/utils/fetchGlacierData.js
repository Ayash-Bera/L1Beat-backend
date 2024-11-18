const axios = require('axios');
const chainService = require('../services/chainService');

const fetchAndUpdateChains = async () => {
  try {
    const response = await axios.get('https://glacier-api.avax.network/v1/chains');
    const chains = response.data.chains;

    for (const chain of chains) {
      await chainService.updateChain(chain);
    }
    
    console.log('Chains data updated successfully');
  } catch (error) {
    console.error('Error fetching/updating chains:', error);
  }
};

module.exports = fetchAndUpdateChains;
