const Chain = require('../models/chain');
const axios = require('axios');
const GLACIER_API_BASE = 'https://glacier-api.avax.network/v1';

class ChainService {
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
            const validatorCount = await this.updateValidatorCount(chainData.subnetId);
            const validators = await this.fetchValidators(chainData.subnetId);
            
            return await Chain.findOneAndUpdate(
                { chainId: chainData.chainId },
                { 
                    ...chainData,
                    validatorCount,
                    validators,
                    lastUpdated: new Date()
                },
                { upsert: true, new: true }
            );
        } catch (error) {
            throw new Error(`Error updating chain: ${error.message}`);
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
            
            const response = await axios.get(
                `${GLACIER_API_BASE}/networks/mainnet/validators`,
                { params: { subnetId } }
            );
            
            if (!response.data.validators) return [];

            return response.data.validators.map(validator => ({
                nodeId: validator.nodeId,
                txHash: validator.txHash,
                amountStaked: validator.amountStaked,
                startTimestamp: validator.startTimestamp,
                endTimestamp: validator.endTimestamp,
                validationStatus: validator.validationStatus,
                uptimePerformance: validator.uptimePerformance,
                avalancheGoVersion: validator.avalancheGoVersion
            }));
        } catch (error) {
            console.error(`Error fetching validators for subnet ${subnetId}:`, error.message);
            return [];
        }
    }
}

module.exports = new ChainService();
