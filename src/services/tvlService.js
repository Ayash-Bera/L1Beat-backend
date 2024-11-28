const TVL = require('../models/tvl');
const axios = require('axios');

class TvlService {
  async updateTvlData() {
    try {
      console.log(`[${process.env.NODE_ENV}] Starting TVL update at ${new Date().toISOString()}`);
      
      // Add request logging
      console.log('Making request to DefiLlama API...');
      const response = await axios.get('https://api.llama.fi/v2/historicalChainTvl/Avalanche', {
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'l1beat-backend'
        }
      });
      
      // Add detailed response logging
      console.log('DefiLlama API Response:', {
        status: response.status,
        statusText: response.statusText,
        dataLength: response.data?.length,
        firstRecord: response.data?.[0],
        lastRecord: response.data?.[response.data.length - 1],
        timestamp: new Date().toISOString()
      });

      const tvlData = response.data;
      
      // Validate data more strictly
      if (!Array.isArray(tvlData) || tvlData.length === 0) {
        throw new Error(`Invalid TVL data received: ${JSON.stringify(tvlData)}`);
      }

      // Log database operation
      console.log(`Attempting to update ${tvlData.length} TVL records in database...`);
      
      const operations = tvlData.map(item => ({
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

      const result = await TVL.bulkWrite(operations);
      
      // Enhanced result logging
      console.log('TVL Update Results:', {
        environment: process.env.NODE_ENV,
        modified: result.modifiedCount,
        upserted: result.upsertedCount,
        matched: result.matchedCount,
        timestamp: new Date().toISOString()
      });

      return true;
    } catch (error) {
      console.error(`[${process.env.NODE_ENV}] TVL Update Error:`, {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
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