const Chain = require('../models/chain');
const axios = require('axios');
const GLACIER_API_BASE = 'https://glacier-api.avax.network/v1';

class ChainService {
    constructor() {
        this.lastUpdated = new Map(); // Track last update time for each chain
        this.updateInterval = 30 * 60 * 1000; // 30 minutes
    }

    // Get all chains
    async getAllChains() {
        try {
            return await Chain.find();
        } catch (error) {
            throw new Error(`Error fetching chains: ${error.message}`);
        }
    }

    // Get chain by ID
    async getChainById(chainId) {
        try {
            const chain = await Chain.findOne({ chainId });
            if (!chain) {
                throw new Error('Chain not found');
            }
            return chain;
        } catch (error) {
            throw new Error(`Error fetching chain: ${error.message}`);
        }
    }

    // Update or create chain
    async updateChain(chainData) {
        try {
            const chainId = chainData.chainId;
            const now = Date.now();
            
            // Check if chain was recently updated
            const lastUpdate = this.lastUpdated.get(chainId);
            if (lastUpdate && (now - lastUpdate) < this.updateInterval) {
                console.log(`Skipping chain ${chainId} - updated ${Math.round((now - lastUpdate)/1000)}s ago`);
                return null;
            }

            console.log(`Updating chain ${chainId} (subnet: ${chainData.subnetId})`);
            
            const validatorCount = await this.updateValidatorCount(chainData.subnetId);
            console.log(`Validator count from metrics API: ${validatorCount}`);
            
            const validators = await this.fetchValidators(chainData.subnetId);
            console.log(`Fetched ${validators.length} validators for chain ${chainId}`);
            
            const updatedChain = await Chain.findOneAndUpdate(
                { chainId },
                { 
                    ...chainData,
                    validatorCount,
                    validators,
                    lastUpdated: new Date()
                },
                { upsert: true, new: true }
            );
            
            // Update last update time
            this.lastUpdated.set(chainId, now);
            
            console.log(`Chain ${chainId} updated with ${updatedChain.validators.length} validators`);
            return updatedChain;
            
        } catch (error) {
            console.error(`Error updating chain ${chainData.chainId}:`, error);
            throw error;
        }
    }

    async updateValidatorCount(subnetId) {
        try {
            if (!subnetId) return null;
            
            const response = await axios.get(
                `https://metrics.avax.network/v2/networks/mainnet/metrics/validatorCount?subnetId=${subnetId}`
            );
            
            // Check if we have data and it has the expected structure
            if (response.data?.results && Array.isArray(response.data.results) && response.data.results.length > 0) {
                // Get the most recent validator count (first item in the array)
                return response.data.results[0].value || null;
            }
            
            return null;
        } catch (error) {
            console.error(`Error fetching validator count for subnet ${subnetId}:`, error.message);
            return null;
        }
    }

    async fetchValidators(subnetId) {
        try {
            if (!subnetId) return [];
            
            let allValidators = [];
            let nextPageToken = null;
            
            do {
                const url = new URL('https://glacier-api.avax.network/v1/networks/mainnet/validators');
                url.searchParams.append('subnetId', subnetId);
                url.searchParams.append('pageSize', '100');
                url.searchParams.append('validationStatus', 'active');
                
                if (nextPageToken) {
                    url.searchParams.append('pageToken', nextPageToken);
                }

                const response = await fetch(url.toString());
                if (!response.ok) {
                    throw new Error(`API request failed with status ${response.status}`);
                }

                const data = await response.json();
                allValidators = [...allValidators, ...data.validators];
                nextPageToken = data.nextPageToken;
                
                console.log(`Fetched ${data.validators.length} validators. Next page token: ${nextPageToken}`);
            } while (nextPageToken);

            console.log(`Total validators fetched: ${allValidators.length}`);
            return allValidators;
            
        } catch (error) {
            console.error(`Error fetching validators for subnet ${subnetId}:`, error);
            return [];
        }
    }

    // Clear update tracking (useful for testing or manual resets)
    clearUpdateTracking() {
        this.lastUpdated.clear();
        console.log('Cleared all chain update tracking');
    }
}

module.exports = new ChainService();
