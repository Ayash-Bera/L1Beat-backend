const chainService = require('../services/chainService');
const tvlService = require('../services/tvlService');
const chainDataService = require('../services/chainDataService');
const Chain = require('../models/chain');

const fetchAndUpdateData = async () => {
    try {
        console.log(`[${process.env.NODE_ENV}] Starting scheduled data update...`);
        
        // Fetch chain data from Glacier API first
        const chains = await chainDataService.fetchChainData();
        console.log(`Fetched ${chains.length} chains from Glacier API`);

        // Only proceed with deletion if we successfully fetched new data
        if (chains && chains.length > 0) {
            // Create a session to handle the transaction
            const session = await Chain.startSession();
            
            try {
                await session.withTransaction(async () => {
                    // Delete existing data
                    await Chain.deleteMany({}, { session });
                    
                    const processedInThisCycle = new Set();
                    
                    // Update chains within the same transaction
                    for (const chain of chains) {
                        if (processedInThisCycle.has(chain.chainId)) {
                            console.log(`Skipping duplicate chain ${chain.chainId} in current cycle`);
                            continue;
                        }
                        
                        await chainService.updateChain(chain);
                        processedInThisCycle.add(chain.chainId);
                    }
                });
            } finally {
                await session.endSession();
            }
            
            console.log(`Processed ${chains.length} unique chains successfully`);
        } else {
            console.warn('No chains fetched from API, skipping database update');
        }

        // Update TVL data independently
        await tvlService.updateTvlData();
        
        console.log(`[${process.env.NODE_ENV}] Data update completed successfully`);
        
    } catch (error) {
        console.error(`[${process.env.NODE_ENV}] Error in scheduled data update:`, {
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        throw error;
    }
};

module.exports = fetchAndUpdateData;
