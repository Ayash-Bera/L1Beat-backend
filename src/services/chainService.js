const Chain = require('../models/chain');
const axios = require('axios');
const GLACIER_API_BASE = 'https://glacier-api.avax.network/v1';
const tpsService = require('../services/tpsService');

class ChainService {
    constructor() {
        this.lastUpdated = new Map(); // Track last update time for each chain
        this.updateInterval = 30 * 60 * 1000; // 30 minutes
    }

    // Get all chains
    async getAllChains() {
        try {
            const chains = await Chain.find();
            
            // Fetch latest TPS for each chain
            const chainsWithTps = await Promise.all(chains.map(async (chain) => {
                try {
                    const tpsData = await tpsService.getLatestTps(chain.chainId);
                    return {
                        ...chain.toObject(),
                        tps: tpsData ? {
                            value: parseFloat(tpsData.value).toFixed(2),
                            timestamp: tpsData.timestamp
                        } : null
                    };
                } catch (error) {
                    console.error(`Error fetching TPS for chain ${chain.chainId}:`, error);
                    return chain;
                }
            }));
            
            return chainsWithTps;
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
            
            console.log(`Chain update attempt for ${chainId}:`, {
                environment: process.env.NODE_ENV,
                timestamp: new Date().toISOString(),
                hasSubnetId: !!chainData.subnetId
            });

            // Check if chain was recently updated
            const lastUpdate = this.lastUpdated.get(chainId);
            if (lastUpdate && (now - lastUpdate) < this.updateInterval) {
                console.log(`Skipping chain ${chainId} - updated ${Math.round((now - lastUpdate)/1000)}s ago`);
                return null;
            }

            const validators = await this.fetchValidators(chainData.subnetId);
            
            console.log(`Chain ${chainId} update details:`, {
                validatorCount: validators.length,
                environment: process.env.NODE_ENV,
                subnetId: chainData.subnetId,
                timestamp: new Date().toISOString()
            });

            const updatedChain = await Chain.findOneAndUpdate(
                { chainId },
                { 
                    ...chainData,
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
