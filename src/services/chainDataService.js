const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');

class ChainDataService {
    constructor() {
        this.GLACIER_API_BASE = config.api.glacier.baseUrl;
    }

    async fetchChainData() {
        try {
            logger.info('Fetching chains from Glacier API...');
            const response = await axios.get(`${this.GLACIER_API_BASE}/chains`, {
                timeout: config.api.glacier.timeout,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'l1beat-backend'
                }
            });
            
            logger.info('Glacier API Response:', {
                status: response.status,
                chainCount: response.data?.chains?.length || 0
            });

            if (!response.data || !response.data.chains) {
                throw new Error('Invalid response from Glacier API');
            }
            
            const chains = response.data.chains.filter(chain => !chain.isTestnet);
            logger.info(`Filtered ${chains.length} non-testnet chains`);
            
            return chains;
            
        } catch (error) {
            logger.error('Error fetching chain data:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw error;
        }
    }
}

module.exports = new ChainDataService(); 