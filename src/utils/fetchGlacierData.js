const chainService = require('../services/chainService');
const tvlService = require('../services/tvlService');
const chainDataService = require('../services/chainDataService');
const Chain = require('../models/chain');

const fetchAndUpdateData = async () => {
    try {
        console.log(`[${process.env.NODE_ENV}] Starting scheduled data update...`);
        
        // Fetch chain data from Glacier API
        const chains = await chainDataService.fetchChainData();
        console.log(`Fetched ${chains.length} chains from Glacier API`);

        // Clear existing data
        await Chain.deleteMany({});
        
        const processedInThisCycle = new Set();
        
        for (const chain of chains) {
            if (processedInThisCycle.has(chain.chainId)) {
                console.log(`Skipping duplicate chain ${chain.chainId} in current cycle`);
                continue;
            }
            
            await chainService.updateChain(chain);
            processedInThisCycle.add(chain.chainId);
        }

        await tvlService.updateTvlData();
        
        console.log(`[${process.env.NODE_ENV}] Chains and TVL data updated successfully`);
        console.log(`Processed ${processedInThisCycle.size} unique chains`);
        
    } catch (error) {
        console.error(`[${process.env.NODE_ENV}] Error in scheduled data update:`, error);
        throw error;
    }
};

module.exports = fetchAndUpdateData;
