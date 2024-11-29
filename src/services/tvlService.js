const TVL = require('../models/tvl');
const axios = require('axios');

class TvlService {
  async updateTvlData(retryCount = 3) {
    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        console.log(`[TVL Update] Attempt ${attempt}/${retryCount} at ${new Date().toISOString()}`);
        
        const response = await axios.get('https://api.llama.fi/v2/historicalChainTvl/Avalanche', {
          timeout: 15000, // Increased timeout
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'l1beat-backend'
          }
        });

        if (!response.data || !Array.isArray(response.data)) {
          throw new Error('Invalid response format from DefiLlama');
        }

        const tvlData = response.data;
        console.log(`Received ${tvlData.length} TVL records, latest date: ${new Date(tvlData[tvlData.length-1].date * 1000).toISOString()}`);

        const result = await TVL.bulkWrite(
          tvlData.map(item => ({
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
          }))
        );

        console.log('TVL Update Success:', {
          modified: result.modifiedCount,
          upserted: result.upsertedCount,
          timestamp: new Date().toISOString()
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
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  async getTvlHistory(days = 30) {
    try {
      console.log(`Fetching TVL history for last ${days} days`);
      const cutoffDate = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
      
      const data = await TVL.find({ date: { $gte: cutoffDate } })
        .sort({ date: 1 })
        .select('-_id date tvl');
      
      console.log(`Found ${data.length} TVL records in database`);
      return data;
    } catch (error) {
      throw new Error(`Error fetching TVL history: ${error.message}`);
    }
  }
}

module.exports = new TvlService(); 