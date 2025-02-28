require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config/config');
const connectDB = require('./config/db');
const chainRoutes = require('./routes/chainRoutes');
const fetchAndUpdateData = require('./utils/fetchGlacierData');
const tvlRoutes = require('./routes/tvlRoutes');
const TVL = require('./models/tvl');
const tvlService = require('./services/tvlService');
const chainDataService = require('./services/chainDataService');
const Chain = require('./models/chain');
const chainService = require('./services/chainService');
const tpsRoutes = require('./routes/tpsRoutes');
const tpsService = require('./services/tpsService');
const TPS = require('./models/tps');
const teleporterRoutes = require('./routes/teleporterRoutes');
const logger = require('./utils/logger');

const app = express();

// Check if we're running on Vercel
const isVercel = process.env.VERCEL === '1';

// Trust proxy when running on Vercel or other cloud platforms
if (isVercel || config.isProduction) {
  logger.info('Running behind a proxy, setting trust proxy to true');
  app.set('trust proxy', 1);
}

// Add debugging logs
logger.info('Starting server', { 
  environment: config.env,
  mongoDbUri: config.isProduction
    ? 'PROD URI is set: ' + !!process.env.PROD_MONGODB_URI
    : 'DEV URI is set: ' + !!process.env.DEV_MONGODB_URI
});

// Environment-specific configurations
const isDevelopment = config.env === 'development';

// Add security headers
app.use(helmet());

// Rate limiting middleware
const apiLimiter = rateLimit(config.rateLimit);

// Apply rate limiting to all API routes
app.use('/api', apiLimiter);

// CORS configuration with environment-specific settings
app.use(cors(config.cors));

app.use(express.json());

// Single initialization point for data updates
const initializeDataUpdates = async () => {
  logger.info(`[${config.env}] Initializing data updates at ${new Date().toISOString()}`);
  
  try {
    // First update chains
    logger.info('Fetching initial chain data...');
    const chains = await chainDataService.fetchChainData();
    logger.info(`Fetched ${chains.length} chains from Glacier API`);

    if (chains && chains.length > 0) {
      for (const chain of chains) {
        await chainService.updateChain(chain);
        // Add initial TPS update for each chain
        await tpsService.updateTpsData(chain.chainId);
      }
      logger.info(`Updated ${chains.length} chains in database`);
      
      // Verify chains were saved
      const savedChains = await Chain.find();
      logger.info('Chains in database:', {
        count: savedChains.length,
        chainIds: savedChains.map(c => c.chainId)
      });
    } else {
      logger.error('No chains fetched from Glacier API');
    }

    // Then update TVL
    logger.info('Updating TVL data...');
    await tvlService.updateTvlData();
    
    // Verify TVL update
    const lastTVL = await TVL.findOne().sort({ date: -1 });
    logger.info('TVL Update Result:', {
      lastUpdate: lastTVL?.date ? new Date(lastTVL.date * 1000).toISOString() : 'none',
      tvl: lastTVL?.tvl,
      timestamp: new Date().toISOString()
    });

    // Initial teleporter data update
    logger.info('Updating initial teleporter data...');
    const teleporterService = require('./services/teleporterService');
    await teleporterService.updateTeleporterData();

    // Initialize weekly data if needed
    if (config.initWeeklyData) {
      logger.info('Initializing weekly data...');
      (async () => {
        try {
          // Use the new method that fetches all data at once
          await teleporterService.fetchWeeklyTeleporterDataAtOnce();
          logger.info('Weekly data initialization completed');
        } catch (error) {
          logger.error('Error initializing weekly data:', {
            message: error.message,
            stack: error.stack
          });
        }
      })();
    }

  } catch (error) {
    logger.error('Initialization error:', error);
  }

  // Set up scheduled updates for both production and development
  logger.info('Setting up update schedules...');
  
  // TVL updates every 30 minutes
  cron.schedule(config.cron.tvlUpdate, async () => {
    try {
      logger.info(`[CRON] Starting scheduled TVL update at ${new Date().toISOString()}`);
      await tvlService.updateTvlData();
      logger.info('[CRON] TVL update completed');
    } catch (error) {
      logger.error('[CRON] TVL update failed:', error);
    }
  });

  // Chain and TPS updates every hour
  cron.schedule(config.cron.chainUpdate, async () => {
    try {
      logger.info(`[CRON] Starting scheduled chain update at ${new Date().toISOString()}`);
      const chains = await chainDataService.fetchChainData();
      for (const chain of chains) {
        await chainService.updateChain(chain);
        // Add TPS update for each chain
        await tpsService.updateTpsData(chain.chainId);
      }
      logger.info(`[CRON] Updated ${chains.length} chains with TPS data`);
    } catch (error) {
      logger.error('[CRON] Chain/TPS update failed:', error);
    }
  });

  // Teleporter data updates every hour
  cron.schedule(config.cron.teleporterUpdate, async () => {
    try {
      logger.info(`[CRON] Starting scheduled teleporter update at ${new Date().toISOString()}`);
      const teleporterService = require('./services/teleporterService');
      await teleporterService.updateTeleporterData();
      logger.info('[CRON] Teleporter update completed');
    } catch (error) {
      logger.error('[CRON] Teleporter update failed:', error);
    }
  });

  // Weekly teleporter data updates once a day
  cron.schedule('0 0 * * *', async () => {
    try {
      logger.info(`[CRON] Starting scheduled weekly teleporter update at ${new Date().toISOString()}`);
      const teleporterService = require('./services/teleporterService');
      
      // Check if there's already an update in progress
      const { TeleporterUpdateState, TeleporterMessage } = require('./models/teleporterMessage');
      const existingUpdate = await TeleporterUpdateState.findOne({ 
        updateType: 'weekly',
        state: 'in_progress'
      });
      
      if (existingUpdate) {
        // Check if it's stale
        const lastUpdated = new Date(existingUpdate.lastUpdatedAt);
        const timeSinceUpdate = new Date().getTime() - lastUpdated.getTime();
        
        if (timeSinceUpdate > 5 * 60 * 1000) { // 5 minutes
          logger.warn('[CRON] Found stale weekly update, resetting it...', {
            lastUpdated: lastUpdated.toISOString(),
            timeSinceUpdateMs: timeSinceUpdate
          });
          
          existingUpdate.state = 'failed';
          existingUpdate.lastUpdatedAt = new Date();
          existingUpdate.error = {
            message: 'Update timed out',
            details: `No updates for ${Math.round(timeSinceUpdate / 1000 / 60)} minutes`
          };
          await existingUpdate.save();
        } else {
          logger.info('[CRON] Weekly update already in progress, skipping...', {
            startedAt: existingUpdate.startedAt,
            lastUpdatedAt: existingUpdate.lastUpdatedAt,
            progress: existingUpdate.progress
          });
          return;
        }
      }
      
      // Check if we have any weekly data
      const anyWeeklyData = await TeleporterMessage.findOne({ dataType: 'weekly' });
      
      // If no data exists, log a special message
      if (!anyWeeklyData) {
        logger.info('[CRON] No weekly teleporter data found, initializing for the first time');
      }
      
      // Start the update using the new method that fetches all data at once
      await teleporterService.fetchWeeklyTeleporterDataAtOnce();
      logger.info('[CRON] Weekly teleporter update completed');
    } catch (error) {
      logger.error('[CRON] Weekly teleporter update failed:', error);
    }
  });

  // Check TPS data every 15 minutes
  cron.schedule(config.cron.tpsVerification, async () => {
    try {
        logger.info(`[CRON] Starting TPS verification at ${new Date().toISOString()}`);
        
        const currentTime = Math.floor(Date.now() / 1000);
        const oneDayAgo = currentTime - (24 * 60 * 60);
        
        // Get chains with missing or old TPS data
        const chains = await Chain.find().select('chainId').lean();
        const tpsData = await TPS.find({
            timestamp: { $gte: oneDayAgo }
        }).distinct('chainId');

        const chainsNeedingUpdate = chains.filter(chain => 
            !tpsData.includes(chain.chainId)
        );

        if (chainsNeedingUpdate.length > 0) {
            logger.info(`[CRON] Found ${chainsNeedingUpdate.length} chains needing TPS update`);
            
            // Update chains in batches
            const BATCH_SIZE = 5;
            for (let i = 0; i < chainsNeedingUpdate.length; i += BATCH_SIZE) {
                const batch = chainsNeedingUpdate.slice(i, i + BATCH_SIZE);
                await Promise.all(
                    batch.map(chain => tpsService.updateTpsData(chain.chainId))
                );
                if (i + BATCH_SIZE < chainsNeedingUpdate.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }

        logger.info(`[CRON] TPS verification complete at ${new Date().toISOString()}`);
    } catch (error) {
        logger.error('[CRON] TPS verification failed:', error);
    }
  });
};

// Call initialization after DB connection
connectDB().then(() => {
  initializeDataUpdates();
});

// Routes
app.use('/api', chainRoutes);
app.use('/api', tvlRoutes);
app.use('/api', tpsRoutes);
app.use('/api', teleporterRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Cache status endpoint (development only)
if (isDevelopment) {
  const cacheManager = require('./utils/cacheManager');
  app.get('/api/cache/status', (req, res) => {
    res.json({
      stats: cacheManager.getStats(),
      environment: config.env,
      timestamp: new Date().toISOString()
    });
  });
}

// Development-only middleware
if (isDevelopment) {
  app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.path}`, { timestamp: new Date().toISOString() });
    next();
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Error:', { message: err.message, stack: err.stack, path: req.path });
  
  // Send proper JSON response
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
    path: req.path
  });
});

// Add catch-all route for undefined routes
app.use('*', (req, res) => {
  logger.warn('Not Found:', { path: req.path, method: req.method });
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource was not found',
    path: req.path
  });
});

// Add OPTIONS handling for preflight requests
app.options('*', cors());

const PORT = process.env.PORT || 5001;

// For Vercel, we need to export the app
module.exports = app;

// Only listen if not running on Vercel
if (!isVercel) {
  const server = app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`, {
      environment: config.env,
      port: PORT,
      timestamp: new Date().toISOString()
    });
    logger.info(`Try accessing: http://localhost:${PORT}/api/chains`);
  });

  // Add error handler for the server
  server.on('error', (error) => {
    logger.error('Server error:', { error: error.message, stack: error.stack });
  });
}
