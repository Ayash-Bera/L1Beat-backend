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

      // Get chain name for logging
      const chain = await Chain.findOne({ chainId }).select('chainName').lean();
      const chainName = chain?.chainName || chainId;

      const cutoffDate = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
      
      const data = await TPS.find({
        chainId,
        timestamp: { $gte: cutoffDate }
      })
        .sort({ timestamp: 1 })
        .select('timestamp value -_id')
        .lean();

      // Format data exactly as frontend expects
      const formattedData = data.map(item => ({
        timestamp: Number(item.timestamp),
        value: parseFloat(item.value)
      }));

      // Add data freshness logging
      if (formattedData.length > 0) {
        const latestTimestamp = formattedData[formattedData.length - 1].timestamp;
        const currentTime = Math.floor(Date.now() / 1000);
        const dataAge = currentTime - latestTimestamp;
        const hoursOld = dataAge / 3600;

        console.log(`Chain ${chainName} (${chainId}) TPS history data age:`, {
          latestDataTime: new Date(latestTimestamp * 1000).toISOString(),
          currentTime: new Date(currentTime * 1000).toISOString(),
          hoursOld: hoursOld.toFixed(1),
          dataPoints: formattedData.length
        });
      }

      return {
        success: true,
        chainName,
        data: formattedData
      };
    } catch (error) {
      console.error(`Error fetching TPS history for chain ${chainId}:`, error);
      return {
        success: false,
        error: 'Failed to fetch TPS history',
        data: []
      };
    }
  }

  async getLatestTps(chainId) {
    try {
      // First try to get from Chain model (faster)
      const chain = await Chain.findOne({ chainId })
        .select('tps chainName')
        .lean();

      if (chain?.tps?.value) {
        console.log(`Found TPS in chain data for ${chain.chainName} (${chainId}):`, chain.tps);
        const value = parseFloat(chain.tps.value);
        
        if (!isNaN(value)) {
          return {
            success: true,
            data: {
              value: value,
              timestamp: chain.tps.timestamp
            }
          };
        }
      }

      // If not in Chain model, try TPS collection
      const latest = await TPS.findOne({ chainId })
        .sort({ timestamp: -1 })
        .select('-_id timestamp value')
        .lean();

      if (!latest) {
        console.log(`No TPS data found for chain ${chainId}`);
        return {
          success: true,
          data: {
            value: null,
            timestamp: null
          }
        };
      }

      const value = parseFloat(latest.value);
      return {
        success: true,
        data: {
          value: isNaN(value) ? null : value,
          timestamp: latest.timestamp
        }
      };
    } catch (error) {
      console.error(`Error fetching latest TPS for chain ${chainId}:`, error);
      return {
        success: false,
        error: 'Failed to fetch TPS data',
        data: {
          value: null,
          timestamp: null
        }
      };
    }
  }

  async getNetworkTps() {
    try {
      const chains = await Chain.find().select('chainId tps').lean();
      const currentTime = Math.floor(Date.now() / 1000);
      const oneDayAgo = currentTime - (24 * 60 * 60);

      const validTps = chains
        .filter(chain => chain.tps && chain.tps.timestamp >= oneDayAgo)
        .map(chain => parseFloat(chain.tps.value) || 0);

      const total = validTps.reduce((sum, value) => sum + value, 0);

      // Match the exact format expected by frontend
      return {
        tps: parseFloat(total.toFixed(2)),
        count: validTps.length,
        timestamp: currentTime
      };
    } catch (error) {
      console.error('Error calculating network TPS:', error);
      throw new Error('Failed to fetch TPS data');
    }
  }

  async getNetworkTpsHistory(days = 7) {
    try {
      const cutoffDate = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
      
      const tpsData = await TPS.aggregate([
        {
          $match: {
            timestamp: { $gte: cutoffDate }
          }
        },
        {
          $group: {
            _id: '$timestamp',
            totalTps: { $sum: '$value' },
            chainCount: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0,
            date: { $multiply: ['$_id', 1000] },
            totalTps: { $round: ['$totalTps', 2] },
            chainCount: 1
          }
        },
        {
          $sort: { date: 1 }
        }
      ]);

      return {
        success: true,
        data: tpsData.map(item => ({
          date: item.date,
          totalTps: parseFloat(item.totalTps).toFixed(2),
          chainCount: item.chainCount
        }))
      };
    } catch (error) {
      console.error('Error fetching network TPS history:', error);
      throw new Error('Failed to fetch TPS data');
    }
  }
}

module.exports = new TpsService(); 