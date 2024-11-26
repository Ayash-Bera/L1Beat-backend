const axios = require('axios');

class ChainDataService {
    constructor() {
        this.GLACIER_API_BASE = 'https://glacier-api.avax.network/v1';
    }

    async fetchChainData() {
        try {
            const response = await axios.get(`${this.GLACIER_API_BASE}/chains`);
            
            // Return the chains directly from the API without modification
            // Just filter out testnet chains
            return response.data.chains.filter(chain => !chain.isTestnet);
            
        } catch (error) {
            console.error('Error fetching chain data:', error);
            throw error;
        }
    }
}

module.exports = new ChainDataService(); 