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
            console.log('Fetching chains from database...');
            
            const chains = await Chain.find({}, {
                chainId: 1,
                chainName: 1,
                status: 1,
                description: 1,
                chainLogoUri: 1,
                explorerUrl: 1,
                rpcUrl: 1,
                networkToken: 1,
                validators: 1,
                'tps.value': 1,
                'tps.timestamp': 1,
                lastUpdated: 1,
                _id: 0
            }).lean();
            
            if (!chains || !Array.isArray(chains)) {
                console.error('Invalid chains data:', chains);
                throw new Error('Failed to fetch chains from database');
            }

            // Format chains to exactly match frontend expectations
            const formattedChains = chains.map(chain => {
                // Format validators to match frontend expectations
                const validators = (chain.validators || []).map(v => ({
                    nodeId: v.nodeId || '',
                    validationStatus: v.validationStatus || 'inactive',
                    uptimePerformance: v.uptimePerformance || 0,
                    amountStaked: v.amountStaked || '0'
                }));

                // Format TPS data to match frontend expectations
                const tpsValue = chain.tps?.value;
                const tps = {
                    value: typeof tpsValue === 'number' ? parseFloat(tpsValue).toFixed(2) : "0.00",
                    timestamp: chain.tps?.timestamp || Math.floor(Date.now() / 1000)
                };

                console.log('Processing chain TPS:', {
                    chainId: chain.chainId,
                    chainName: chain.chainName,
                    rawTps: chain.tps,
                    formattedTps: tps
                });

                return {
                    chainId: chain.chainId,
                    chainName: chain.chainName || 'Unknown Chain',
                    validators: validators,
                    validatorCount: validators.filter(v => v.validationStatus === 'active').length,
                    tvl: 50000000000,
                    tps: tps,
                    networkStats: {
                        blockTime: "2s",
                        finality: "2s",
                        networkUsage: "65%",
                        stakeRequirement: "2,000 AVAX",
                        uptime: "99.9%"
                    },
                    economics: {
                        marketCap: "500M",
                        circulatingSupply: chain.networkToken?.description || "N/A",
                        totalSupply: "250M",
                        stakingAPR: "8.5%"
                    },
                    stakeDistribution: [
                        { name: "Top 1-10", value: 35, fill: "#8884d8" },
                        { name: "Top 11-50", value: 30, fill: "#82ca9d" },
                        { name: "Top 51-100", value: 20, fill: "#ffc658" },
                        { name: "Others", value: 15, fill: "#ff8042" }
                    ],
                    description: chain.description || '',
                    explorerUrl: chain.explorerUrl || '',
                    rpcUrl: chain.rpcUrl || '',
                    networkToken: chain.networkToken || {
                        name: 'AVAX',
                        symbol: 'AVAX',
                        decimals: 18
                    },
                    chainLogoUri: chain.chainLogoUri || ''
                };
            });

            // Log first chain for debugging
            if (formattedChains.length > 0) {
                console.log('Sample chain data:', {
                    chainId: formattedChains[0].chainId,
                    chainName: formattedChains[0].chainName,
                    tps: formattedChains[0].tps,
                    validatorCount: formattedChains[0].validatorCount
                });
            }

            return formattedChains;
        } catch (error) {
            console.error('Error in getAllChains:', error);
            throw error;
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
