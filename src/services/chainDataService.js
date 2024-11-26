const axios = require('axios');

class ChainDataService {
    constructor() {
        this.GLACIER_API_BASE = 'https://glacier-api.avax.network/v1';
    }

    async fetchChainData() {
        try {
            // Fetch chains
            const response = await axios.get(`${this.GLACIER_API_BASE}/chains`);
            
            if (!response.data || !response.data.chains) {
                console.error('Invalid response from Glacier API:', response.data);
                return [];
            }
            
            const chains = response.data.chains.filter(chain => !chain.isTestnet);
            console.log(`Successfully fetched ${chains.length} chains from Glacier API`);
            
            return chains;
            
        } catch (error) {
            console.error('Error fetching chain data:', error.message);
            console.error('Full error:', error);
            return [];
        }
    }
}

module.exports = new ChainDataService(); 