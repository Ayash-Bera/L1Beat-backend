const Chain = require('../models/chain');
const axios = require('axios');
const config = require('../config/config');
const tpsService = require('../services/tpsService');
const cacheManager = require('../utils/cacheManager');
const logger = require('../utils/logger');

class ChainService {
    constructor() {
        this.lastUpdated = new Map(); // Track last update time for each chain
        this.updateInterval = 30 * 60 * 1000; // 30 minutes
    }

    // Get all chains
    async getAllChains() {
        try {
            // Check cache first
            const cacheKey = 'all_chains';
            const cachedChains = cacheManager.get(cacheKey);
            if (cachedChains) {
                logger.debug('Returning cached chains data');
                return cachedChains;
            }

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
                    logger.error(`Error fetching TPS for chain ${chain.chainId}:`, { error: error.message });
                    return chain;
                }
            }));
            
            // Cache the result for 5 minutes
            cacheManager.set(cacheKey, chainsWithTps, config.cache.chains);
            
            return chainsWithTps;
        } catch (error) {
            logger.error('Error fetching chains:', { error: error.message });
            throw new Error(`Error fetching chains: ${error.message}`);
        }
    }

    // Get chain by ID
    async getChainById(chainId) {
        try {
            // Check cache first
            const cacheKey = `chain_${chainId}`;
            const cachedChain = cacheManager.get(cacheKey);
            if (cachedChain) {
                logger.debug(`Returning cached data for chain ${chainId}`);
                return cachedChain;
            }

            const chain = await Chain.findOne({ chainId });
            if (!chain) {
                throw new Error('Chain not found');
            }
            
            // Cache the result for 5 minutes
            cacheManager.set(cacheKey, chain, config.cache.chains);
            
            return chain;
        } catch (error) {
            logger.error(`Error fetching chain ${chainId}:`, { error: error.message });
            throw new Error(`Error fetching chain: ${error.message}`);
        }
    }

    // Update or create chain
    async updateChain(chainData) {
        try {
            const chainId = chainData.chainId;
            const now = Date.now();
            
            logger.info(`Chain update attempt for ${chainId}:`, {
                environment: config.env,
                timestamp: new Date().toISOString(),
                hasSubnetId: !!chainData.subnetId
            });

            // Check if chain was recently updated
            const lastUpdate = this.lastUpdated.get(chainId);
            if (lastUpdate && (now - lastUpdate) < this.updateInterval) {
                logger.info(`Skipping chain ${chainId} - updated ${Math.round((now - lastUpdate)/1000)}s ago`);
                return null;
            }

            const validators = await this.fetchValidators(chainData.subnetId);
            
            logger.info(`Chain ${chainId} update details:`, {
                validatorCount: validators.length,
                environment: config.env,
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
            
            // Invalidate cache for this chain
            cacheManager.delete(`chain_${chainId}`);
            cacheManager.delete('all_chains');
            
            logger.info(`Chain ${chainId} updated with ${updatedChain.validators.length} validators`);
            return updatedChain;
            
        } catch (error) {
            logger.error(`Error updating chain ${chainData.chainId}:`, { error: error.message, stack: error.stack });
            throw error;
        }
    }

    async fetchValidators(subnetId) {
        try {
            if (!subnetId) return [];
            
            let allValidators = [];
            let nextPageToken = null;
            
            do {
                const url = new URL(`${config.api.glacier.baseUrl}/networks/mainnet/validators`);
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
                
                logger.debug(`Fetched ${data.validators.length} validators. Next page token: ${nextPageToken}`);
            } while (nextPageToken);

            logger.info(`Total validators fetched: ${allValidators.length}`);
            return allValidators;
            
        } catch (error) {
            logger.error(`Error fetching validators for subnet ${subnetId}:`, { error: error.message });
            return [];
        }
    }

    // Clear update tracking (useful for testing or manual resets)
    clearUpdateTracking() {
        this.lastUpdated.clear();
        logger.info('Cleared all chain update tracking');
    }
}

module.exports = new ChainService();
