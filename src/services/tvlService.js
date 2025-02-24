const TVL = require('../models/tvl');
const axios = require('axios');
const cacheManager = require('../utils/cacheManager');
const config = require('../config/config');
const logger = require('../utils/logger');

class TvlService {
  async updateTvlData(retryCount = 3) {
    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        logger.info(`[TVL Update] Attempt ${attempt}/${retryCount} at ${new Date().toISOString()}`);
        
        // Get both historical and current TVL
        const [historicalResponse, currentResponse] = await Promise.all([
          axios.get(`${config.api.defillama.baseUrl}/historicalChainTvl/Avalanche`, {
            timeout: config.api.defillama.timeout,
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'l1beat-backend'
            }
          }),
          axios.get(`${config.api.defillama.baseUrl}/chains`, {
            timeout: config.api.defillama.timeout,
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'l1beat-backend'
            }
          })
        ]);

        // Get current Avalanche TVL
        const currentTvl = currentResponse.data.find(chain => 
          chain.name.toLowerCase() === 'avalanche'
        );

        if (!currentTvl) {
          throw new Error('Could not find current Avalanche TVL');
        }

        // Process historical data
        const historicalTvl = historicalResponse.data;
        if (!historicalTvl || !Array.isArray(historicalTvl)) {
          throw new Error('Invalid historical TVL data format');
        }

        // Combine historical and current data
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const validTvlData = [
          // Add current TVL
          {
            date: currentTimestamp,
            tvl: currentTvl.tvl
          },
          // Add historical data
          ...historicalTvl.filter(item => 
            item && 
            typeof item.date === 'number' && 
            typeof item.tvl === 'number' && 
            !isNaN(item.tvl) &&
            item.date < currentTimestamp
          )
        ];

        // Sort by date in descending order
        validTvlData.sort((a, b) => b.date - a.date);

        logger.info('TVL Data Analysis:', {
          historicalEntries: historicalTvl.length,
          currentTvl: currentTvl.tvl,
          mostRecentHistorical: new Date(historicalTvl[historicalTvl.length - 1].date * 1000).toISOString(),
          currentTime: new Date(currentTimestamp * 1000).toISOString(),
          combinedEntries: validTvlData.length
        });

        // Update database using bulkWrite for better performance
        const bulkOps = validTvlData.map(item => ({
          updateOne: {
            filter: { date: item.date },
            update: { 
              $set: { 
                tvl: item.tvl,
                lastUpdated: new Date() 
              }
            },
            upsert: true
          }
        }));

        logger.info(`Preparing to update ${bulkOps.length} TVL records`);
        const result = await TVL.bulkWrite(bulkOps);

        // Verify the update
        const latestInDb = await TVL.findOne().sort({ date: -1 });
        logger.info('Database verification after update:', {
          recordsMatched: result.matchedCount,
          recordsModified: result.modifiedCount,
          recordsUpserted: result.upsertedCount,
          latestRecord: {
            date: new Date(latestInDb.date * 1000).toISOString(),
            tvl: latestInDb.tvl
          }
        });

        // Invalidate all TVL cache entries
        Object.keys(cacheManager.cache).forEach(key => {
          if (key.startsWith('tvl_history_')) {
            cacheManager.delete(key);
          }
        });
        logger.info('TVL cache invalidated after update');

        return true;

      } catch (error) {
        logger.error(`TVL Update Error (Attempt ${attempt}/${retryCount}):`, {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
          timestamp: new Date().toISOString()
        });

        if (attempt === retryCount) {
          throw error;
        }
        
        const delay = attempt * 5000;
        logger.info(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async getTvlHistory(days = 30) {
    try {
      logger.info(`Fetching TVL history for last ${days} days`);
      
      // Check cache first
      const cacheKey = `tvl_history_${days}`;
      const cachedData = cacheManager.get(cacheKey);
      if (cachedData) {
        logger.debug(`Returning cached TVL history for ${days} days`);
        return cachedData;
      }
      
      const cutoffDate = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
      
      // Always try to update data before returning
      await this.updateTvlData().catch(error => {
        logger.error('Failed to update TVL data:', { error: error.message });
      });
      
      const data = await TVL.find({ date: { $gte: cutoffDate } })
        .sort({ date: 1 })
        .select('-_id date tvl')
        .lean();
      
      logger.info(`Found ${data.length} TVL records in database`);
      
      // Cache the result for 15 minutes
      cacheManager.set(cacheKey, data, config.cache.tvlHistory);
      
      return data;
    } catch (error) {
      logger.error('Error in getTvlHistory:', { error: error.message, stack: error.stack });
      throw new Error(`Error fetching TVL history: ${error.message}`);
    }
  }
}

module.exports = new TvlService(); 