const TVL = require('../models/tvl');
const axios = require('axios');

class TvlService {
  async updateTvlData() {
    try {
      console.log('Fetching TVL data from DefiLlama...');
      const response = await axios.get('https://api.llama.fi/v2/historicalChainTvl/Avalanche');
      const tvlData = response.data;
      
      console.log(`Received ${tvlData.length} TVL records from API`);

      if (!Array.isArray(tvlData) || tvlData.length === 0) {
        throw new Error('Invalid or empty TVL data received');
      }

      // Bulk upsert operation
      const operations = tvlData.map(item => ({
        updateOne: {
          filter: { date: item.date },
          update: { $set: { tvl: item.tvl, lastUpdated: new Date() } },
          upsert: true
        }
      }));

      const result = await TVL.bulkWrite(operations);
      console.log('TVL update result:', {
        modified: result.modifiedCount,
        upserted: result.upsertedCount
      });
      
      return true;
    } catch (error) {
      console.error('Error updating TVL data:', error);
      throw error;
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