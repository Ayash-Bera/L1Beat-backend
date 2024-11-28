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

        // Only proceed if we successfully fetched new data
        if (chains && chains.length > 0) {
            try {
                // Check if we're using a replica set (production) or standalone (development)
                const isReplicaSet = process.env.NODE_ENV === 'production';
                
                if (isReplicaSet) {
                    // Production: Use transactions
                    const session = await Chain.startSession();
                    try {
                        await session.withTransaction(async () => {
                            await updateChains(chains, session);
                        });
                    } finally {
                        await session.endSession();
                    }
                } else {
                    // Development: Direct updates without transaction
                    await updateChains(chains);
                }
                
                console.log(`Processed ${chains.length} unique chains successfully`);
            } catch (error) {
                console.error('Error updating chains:', error);
                throw error;
            }
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

// Helper function to update chains
async function updateChains(chains, session = null) {
    const options = session ? { session } : {};
    
    // Delete existing data
    await Chain.deleteMany({}, options);
    
    const processedInThisCycle = new Set();
    
    // Update chains
    for (const chain of chains) {
        if (processedInThisCycle.has(chain.chainId)) {
            console.log(`Skipping duplicate chain ${chain.chainId} in current cycle`);
            continue;
        }
        
        await chainService.updateChain(chain);
        processedInThisCycle.add(chain.chainId);
    }
}

module.exports = fetchAndUpdateData;
