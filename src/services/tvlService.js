const TVL = require('../models/tvl');
const axios = require('axios');

class TvlService {
  async updateTvlData(retryCount = 3) {
    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        console.log(`[TVL Update] Attempt ${attempt}/${retryCount} at ${new Date().toISOString()}`);
        
        // Get both historical and current TVL
        const [historicalResponse, currentResponse] = await Promise.all([
          axios.get('https://api.llama.fi/v2/historicalChainTvl/Avalanche', {
            timeout: 30000,
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'l1beat-backend'
            }
          }),
          axios.get('https://api.llama.fi/v2/chains', {
            timeout: 30000,
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

        console.log('TVL Data Analysis:', {
          historicalEntries: historicalTvl.length,
          currentTvl: currentTvl.tvl,
          mostRecentHistorical: new Date(historicalTvl[historicalTvl.length - 1].date * 1000).toISOString(),
          currentTime: new Date(currentTimestamp * 1000).toISOString(),
          combinedEntries: validTvlData.length
        });

        // Update database
        await TVL.deleteMany({});
        const result = await TVL.insertMany(
          validTvlData.map(item => ({
            date: item.date,
            tvl: item.tvl,
            lastUpdated: new Date()
          }))
        );

        // Verify the update
        const latestInDb = await TVL.findOne().sort({ date: -1 });
        console.log('Database verification after update:', {
          recordsInserted: result.length,
          latestRecord: {
            date: new Date(latestInDb.date * 1000).toISOString(),
            tvl: latestInDb.tvl
          }
        });

        return true;

      } catch (error) {
        console.error(`TVL Update Error (Attempt ${attempt}/${retryCount}):`, {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
          timestamp: new Date().toISOString()
        });

        if (attempt === retryCount) {
          throw error;
        }
        
        const delay = attempt * 5000;
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async getTvlHistory(days = 30) {
    try {
      console.log(`Fetching TVL history for last ${days} days`);
      const cutoffDate = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
      
      // Always try to update data before returning
      await this.updateTvlData().catch(error => {
        console.error('Failed to update TVL data:', error);
      });
      
      const data = await TVL.find({ date: { $gte: cutoffDate } })
        .sort({ date: 1 })
        .select('-_id date tvl')
        .lean();
      
      console.log(`Found ${data.length} TVL records in database`);
      return data;
    } catch (error) {
      console.error('Error in getTvlHistory:', error);
      throw new Error(`Error fetching TVL history: ${error.message}`);
    }
  }
}

module.exports = new TvlService(); 