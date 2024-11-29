const axios = require('axios');

class ChainDataService {
    constructor() {
        this.GLACIER_API_BASE = 'https://glacier-api.avax.network/v1';
    }

    async fetchChainData() {
        try {
            console.log('Fetching chains from Glacier API...');
            const response = await axios.get(`${this.GLACIER_API_BASE}/chains`, {
                timeout: 10000,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'l1beat-backend'
                }
            });
            
            console.log('Glacier API Response:', {
                status: response.status,
                chainCount: response.data?.chains?.length || 0
            });

            if (!response.data || !response.data.chains) {
                throw new Error('Invalid response from Glacier API');
            }
            
            const chains = response.data.chains.filter(chain => !chain.isTestnet);
            console.log(`Filtered ${chains.length} non-testnet chains`);
            
            return chains;
            
        } catch (error) {
            console.error('Error fetching chain data:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw error;
        }
    }
}

module.exports = new ChainDataService(); 