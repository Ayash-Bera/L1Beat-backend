const TVL = require('../models/tvl');
const axios = require('axios');

class TvlService {
  async updateTvlData() {
    try {
      console.log(`[${process.env.NODE_ENV}] Fetching TVL data from DefiLlama...`);
      const response = await axios.get('https://api.llama.fi/v2/historicalChainTvl/Avalanche', {
        timeout: 10000
      });
      
      console.log('Raw DefiLlama response:', {
        status: response.status,
        dataLength: response.data?.length,
        sampleData: response.data?.[0]
      });

      const tvlData = response.data;
      
      console.log(`[${process.env.NODE_ENV}] Received ${tvlData.length} TVL records from API`);

      if (!Array.isArray(tvlData) || tvlData.length === 0) {
        throw new Error('Invalid or empty TVL data received');
      }

      // Add timestamp logging
      const latestDate = Math.max(...tvlData.map(item => item.date));
      console.log(`[${process.env.NODE_ENV}] Latest TVL date in data:`, new Date(latestDate * 1000).toISOString());

      // Bulk upsert operation
      const operations = tvlData.map(item => ({
        updateOne: {
          filter: { date: item.date },
          update: { $set: { tvl: item.tvl, lastUpdated: new Date() } },
          upsert: true
        }
      }));

      const result = await TVL.bulkWrite(operations);
      console.log(`[${process.env.NODE_ENV}] TVL update result:`, {
        modified: result.modifiedCount,
        upserted: result.upsertedCount,
        timestamp: new Date().toISOString()
      });
      
      return true;
    } catch (error) {
      console.error(`[${process.env.NODE_ENV}] Error updating TVL data:`, {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
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