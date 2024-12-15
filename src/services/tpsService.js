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
            'Accept': 'application/json',
            'User-Agent': 'l1beat-backend'
          }
        });

        // Log raw response for debugging
        console.log(`Raw API response for chain ${chainId}:`, {
          status: response.status,
          hasData: !!response.data,
          resultsLength: response.data?.results?.length,
          sample: response.data?.results?.[0]
        });

        if (!response.data || !Array.isArray(response.data.results)) {
          console.warn(`No TPS data available for chain ${chainId} - skipping`);
          return null;
        }

        const tpsData = response.data.results;
        if (tpsData.length === 0) {
          console.warn(`Empty TPS data for chain ${chainId} - skipping`);
          return null;
        }
        
        // Validate timestamps before processing
        const validTpsData = tpsData.filter(item => {
          // Check if timestamp is a valid number and not too far in the past or future
          const timestamp = Number(item.timestamp);
          if (isNaN(timestamp)) {
            console.warn(`Invalid timestamp found for chain ${chainId}:`, item);
            return false;
          }
          
          const date = new Date(timestamp * 1000);
          if (date.toString() === 'Invalid Date') {
            console.warn(`Invalid date conversion for chain ${chainId}:`, { timestamp, item });
            return false;
          }
          
          // Reject timestamps more than 30 days in the past or any future timestamps
          const now = Date.now();
          const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
          const isValid = date.getTime() >= thirtyDaysAgo && date.getTime() <= now;
          
          if (!isValid) {
            console.warn(`Timestamp out of range for chain ${chainId}:`, {
              timestamp,
              date: date.toISOString(),
              now: new Date(now).toISOString(),
              thirtyDaysAgo: new Date(thirtyDaysAgo).toISOString()
            });
          }
          return isValid;
        });

        if (validTpsData.length === 0) {
          console.warn(`No valid TPS data found for chain ${chainId} - skipping`);
          return null;
        }

        // Now process only valid timestamps
        const timestamps = validTpsData.map(item => Number(item.timestamp));
        const mostRecent = Math.max(...timestamps);
        const oldest = Math.min(...timestamps);
        
        console.log(`TPS API Response Analysis for chain ${chainId}:`, {
          totalRecords: tpsData.length,
          validRecords: validTpsData.length,
          oldestRecord: new Date(oldest * 1000).toISOString(),
          mostRecentRecord: new Date(mostRecent * 1000).toISOString(),
          currentTime: new Date().toISOString(),
          dataAge: Math.floor((Date.now()/1000 - mostRecent)/60), // in minutes
          sampleRecord: validTpsData[0],
          environment: process.env.NODE_ENV
        });

        const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
        const recentTpsData = validTpsData.filter(item => Number(item.timestamp) >= sevenDaysAgo);

        // Log what we're actually storing
        console.log(`Filtered TPS data for chain ${chainId}:`, {
          originalCount: tpsData.length,
          validCount: validTpsData.length,
          filteredCount: recentTpsData.length,
          oldestKept: recentTpsData.length ? 
            new Date(Math.min(...recentTpsData.map(d => Number(d.timestamp) * 1000))).toISOString() : null,
          newestKept: recentTpsData.length ? 
            new Date(Math.max(...recentTpsData.map(d => Number(d.timestamp) * 1000))).toISOString() : null
        });

        if (recentTpsData.length === 0) {
          console.warn(`No recent TPS data available for chain ${chainId}`);
          return null;
        }

        const result = await TPS.bulkWrite(
          recentTpsData.map(item => ({
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
          data: error.response?.data,
          environment: process.env.NODE_ENV,
          stack: error.stack
        });

        // Don't retry if it's a 404 or other indication that the chain doesn't have TPS data
        if (error.response?.status === 404 || error.response?.status === 400) {
          console.warn(`Chain ${chainId} appears to not have TPS data - skipping`);
          return null;
        }

        if (attempt === retryCount) {
          // Don't throw on final attempt, just return null
          console.warn(`All attempts failed for chain ${chainId} - skipping`);
          return null;
        }
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
    return null;
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