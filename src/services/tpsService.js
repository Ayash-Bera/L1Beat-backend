const TPS = require('../models/tps');
const axios = require('axios');
const Chain = require('../models/chain');

class TpsService {
  async updateTpsData(chainId, retryCount = 3) {
    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        console.log(`[TPS Update] Attempt ${attempt}/${retryCount} for chain ${chainId}`);
        
        // Add timestamp to log for debugging
        const currentTime = Math.floor(Date.now() / 1000);
        console.log(`Current timestamp: ${currentTime} (${new Date(currentTime * 1000).toISOString()})`);
        
        const response = await axios.get(`https://popsicle-api.avax.network/v1/avg_tps/${chainId}`, {
          timeout: 15000,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'l1beat-backend'
          }
        });

        if (!response.data || !Array.isArray(response.data.results)) {
          throw new Error(`Invalid TPS data format for chain ${chainId}`);
        }

        const tpsData = response.data.results;
        
        // Log the latest TPS data point
        if (tpsData.length > 0) {
          const latest = tpsData[0];
          console.log(`Latest TPS data for chain ${chainId}:`, {
            timestamp: latest.timestamp,
            date: new Date(latest.timestamp * 1000).toISOString(),
            value: latest.value
          });
        }

        // Store all valid TPS data points
        const result = await TPS.bulkWrite(
          tpsData.map(item => ({
            updateOne: {
              filter: { 
                chainId: chainId,
                timestamp: Number(item.timestamp)
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

        // Update the chain's latest TPS
        await Chain.updateOne(
          { chainId },
          { 
            $set: {
              'tps.value': parseFloat(tpsData[0]?.value || 0),
              'tps.timestamp': Number(tpsData[0]?.timestamp || 0),
              'tps.lastUpdated': new Date()
            }
          }
        );

        console.log(`TPS Update completed for chain ${chainId}:`, {
          matched: result.matchedCount,
          modified: result.modifiedCount,
          upserted: result.upsertedCount,
          environment: process.env.NODE_ENV
        });

        return result;

      } catch (error) {
        console.error(`TPS Update Error for chain ${chainId} (Attempt ${attempt}/${retryCount}):`, {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data
        });

        if (attempt === retryCount) {
          throw error;
        }
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
      const chains = await Chain.find().select('chainId').lean();
      
      const currentTime = Math.floor(Date.now() / 1000);
      const oneDayAgo = currentTime - (24 * 60 * 60);

      console.log('Time boundaries:', {
        currentTime: new Date(currentTime * 1000).toISOString(),
        oneDayAgo: new Date(oneDayAgo * 1000).toISOString(),
        environment: process.env.NODE_ENV
      });

      const latestTpsPromises = chains.map(chain => 
        TPS.findOne({ 
          chainId: chain.chainId,
          timestamp: { $gte: oneDayAgo }
        })
          .sort({ timestamp: -1 })
          .select('value timestamp')
          .lean()
      );

      const tpsResults = await Promise.all(latestTpsPromises);
      const validResults = tpsResults.filter(result => result !== null);
      
      const timestamps = validResults.map(r => r.timestamp);
      const futureTimestamps = timestamps.filter(t => t > currentTime);
      if (futureTimestamps.length > 0) {
        console.warn('Found future timestamps:', {
          count: futureTimestamps.length,
          timestamps: futureTimestamps.map(t => new Date(t * 1000).toISOString())
        });
      }

      console.log('Network TPS calculation:', {
        totalChains: chains.length,
        validResults: validResults.length,
        oldestTimestamp: validResults.length ? new Date(Math.min(...timestamps) * 1000).toISOString() : null,
        newestTimestamp: validResults.length ? new Date(Math.max(...timestamps) * 1000).toISOString() : null,
        currentTime: new Date(currentTime * 1000).toISOString(),
        environment: process.env.NODE_ENV
      });

      if (validResults.length === 0) {
        return {
          totalTps: 0,
          chainCount: 0,
          timestamp: currentTime,
          updatedAt: new Date().toISOString(),
          dataAge: 0,
          dataAgeUnit: 'minutes'
        };
      }

      const total = validResults.reduce((sum, result) => sum + (result.value || 0), 0);
      const latestTimestamp = Math.max(...timestamps);
      const dataAge = Math.max(0, Math.floor((currentTime - latestTimestamp) / 60)); // Convert to minutes

      if (dataAge > 24 * 60) { // More than 24 hours in minutes
        console.warn(`TPS data is ${dataAge} minutes old (${(dataAge/60).toFixed(1)} hours)`);
      }

      return {
        totalTps: parseFloat(total.toFixed(2)),
        chainCount: validResults.length,
        timestamp: latestTimestamp,
        updatedAt: new Date().toISOString(),
        dataAge,
        dataAgeUnit: 'minutes',
        lastUpdate: new Date(latestTimestamp * 1000).toISOString()
      };
    } catch (error) {
      console.error('Error calculating network TPS:', {
        message: error.message,
        stack: error.stack,
        environment: process.env.NODE_ENV
      });
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