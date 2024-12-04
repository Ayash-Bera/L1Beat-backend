const TPS = require('../models/tps');
const axios = require('axios');
const Chain = require('../models/chain');

class TpsService {
  async updateTpsData(chainId, retryCount = 3) {
    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        console.log(`[TPS Update] Attempt ${attempt}/${retryCount} for chain ${chainId}`);
        
        const response = await axios.get(`https://popsicle-api.avax.network/v1/avg_tps/${chainId}`, {
          timeout: 15000,
          headers: {
            'Accept': 'application/json'
          }
        });

        if (!response.data || !Array.isArray(response.data.results)) {
          throw new Error('Invalid response format from Popsicle API');
        }

        const tpsData = response.data.results;
        console.log(`Received ${tpsData.length} TPS records for chain ${chainId}`);

        const result = await TPS.bulkWrite(
          tpsData.map(item => ({
            updateOne: {
              filter: { 
                chainId: chainId,
                timestamp: item.timestamp 
              },
              update: { 
                $set: { 
                  value: parseFloat(item.value),
                  lastUpdated: new Date() 
                }
              },
              upsert: true
            }
          }))
        );

        console.log(`TPS Update completed for chain ${chainId}:`, {
          matched: result.matchedCount,
          modified: result.modifiedCount,
          upserted: result.upsertedCount
        });

        return result;

      } catch (error) {
        console.error(`TPS Update Error for chain ${chainId} (Attempt ${attempt}/${retryCount}):`, {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data
        });

        if (attempt === retryCount) throw error;
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  async getTpsHistory(chainId, days = 30) {
    try {
      const existingData = await TPS.countDocuments({ chainId });
      
      if (existingData === 0) {
        console.log(`No TPS history found for chain ${chainId}, fetching from API...`);
        await this.updateTpsData(chainId);
      }

      const cutoffDate = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
      
      const data = await TPS.find({
        chainId,
        timestamp: { $gte: cutoffDate }
      })
        .sort({ timestamp: -1 })
        .select('-_id timestamp value')
        .lean();
      
      console.log(`Found ${data.length} TPS records for chain ${chainId}`);
      return data;
    } catch (error) {
      throw new Error(`Error fetching TPS history: ${error.message}`);
    }
  }

  async getLatestTps(chainId) {
    try {
      let latest = await TPS.findOne({ chainId })
        .sort({ timestamp: -1 })
        .select('-_id timestamp value')
        .lean();

      if (!latest) {
        console.log(`No TPS data found for chain ${chainId}, fetching from API...`);
        await this.updateTpsData(chainId);
        latest = await TPS.findOne({ chainId })
          .sort({ timestamp: -1 })
          .select('-_id timestamp value')
          .lean();
      }
      
      return latest;
    } catch (error) {
      throw new Error(`Error fetching latest TPS: ${error.message}`);
    }
  }

  async getNetworkTps() {
    try {
      // Get all chains to ensure we have their IDs
      const chains = await Chain.find().select('chainId').lean();
      
      // Get the latest TPS for each chain
      const latestTpsPromises = chains.map(chain => 
        TPS.findOne({ chainId: chain.chainId })
          .sort({ timestamp: -1 })
          .select('value timestamp')
          .lean()
      );

      const tpsResults = await Promise.all(latestTpsPromises);
      
      // Filter out null results and calculate total
      const validResults = tpsResults.filter(result => result !== null);
      const total = validResults.reduce((sum, result) => sum + (result.value || 0), 0);
      
      // Find the most recent timestamp
      const latestTimestamp = Math.max(...validResults.map(result => result.timestamp));

      return {
        totalTps: parseFloat(total.toFixed(2)),
        chainCount: validResults.length,
        timestamp: latestTimestamp,
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Error calculating network TPS: ${error.message}`);
    }
  }

  async getNetworkTpsHistory(days = 7) {
    try {
      const cutoffDate = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
      
      // Get all chains
      const chains = await Chain.find().select('chainId').lean();
      
      // Get TPS data for all chains within the time range
      const tpsData = await TPS.aggregate([
        {
          $match: {
            chainId: { $in: chains.map(c => c.chainId) },
            timestamp: { $gte: cutoffDate }
          }
        },
        {
          // Group by timestamp and sum the values
          $group: {
            _id: '$timestamp',
            totalTps: { $sum: '$value' },
            chainCount: { $sum: 1 }
          }
        },
        {
          // Format the output
          $project: {
            _id: 0,
            timestamp: '$_id',
            totalTps: { $round: ['$totalTps', 2] },
            chainCount: 1
          }
        },
        {
          // Sort by timestamp
          $sort: { timestamp: 1 }
        }
      ]);

      // Add metadata to each data point
      const enrichedData = tpsData.map(point => ({
        ...point,
        date: new Date(point.timestamp * 1000).toISOString()
      }));

      console.log(`Found ${enrichedData.length} historical network TPS records`);
      return enrichedData;
    } catch (error) {
      throw new Error(`Error fetching network TPS history: ${error.message}`);
    }
  }
}

module.exports = new TpsService(); 