require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const connectDB = require('./config/db');
const chainRoutes = require('./routes/chainRoutes');
const fetchAndUpdateData = require('./utils/fetchGlacierData');
const tvlRoutes = require('./routes/tvlRoutes');
require('./models/tvl');

const app = express();

// Add debugging logs
console.log('Starting server with environment:', process.env.NODE_ENV);
console.log('MongoDB URI:', process.env.NODE_ENV === 'production' 
  ? 'PROD URI is set: ' + !!process.env.PROD_MONGODB_URI
  : 'DEV URI is set: ' + !!process.env.DEV_MONGODB_URI
);

// Environment-specific configurations
const isDevelopment = process.env.NODE_ENV === 'development';

// CORS configuration with environment-specific settings
app.use(cors({
  origin: isDevelopment 
    ? '*' 
    : ['https://l1beat.io', 'https://www.l1beat.io', 'http://localhost:4173', 'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

app.use(express.json());

// Single initialization point for data updates
const initializeDataUpdates = async () => {
  console.log(`Initializing data updates for ${process.env.NODE_ENV} environment at ${new Date().toISOString()}`);
  
  // Initial fetch for all environments
  try {
    await fetchAndUpdateData();
    console.log('Initial data fetch completed successfully');
  } catch (error) {
    console.error('Initial data fetch failed:', error);
  }

  // Set up scheduled updates only in production
  if (process.env.NODE_ENV === 'production') {
    console.log('Setting up production scheduled tasks...');
    
    // Add immediate update check
    const lastTVL = await TVL.findOne().sort({ date: -1 });
    console.log('Last TVL record:', {
      date: lastTVL?.date ? new Date(lastTVL.date * 1000).toISOString() : 'none',
      tvl: lastTVL?.tvl,
      lastUpdated: lastTVL?.lastUpdated
    });

    // Setup cron with better logging
    cron.schedule('*/30 * * * *', async () => {
      console.log(`Running scheduled TVL update at ${new Date().toISOString()}`);
      try {
        await fetchAndUpdateData();
        console.log('Scheduled update completed successfully');
        
        // Verify update
        const latestTVL = await TVL.findOne().sort({ date: -1 });
        console.log('Latest TVL after update:', {
          date: latestTVL?.date ? new Date(latestTVL.date * 1000).toISOString() : 'none',
          tvl: latestTVL?.tvl,
          lastUpdated: latestTVL?.lastUpdated
        });
      } catch (error) {
        console.error('Scheduled update failed:', error);
      }
    });
  }
};

// Call initialization after DB connection
connectDB().then(() => {
  initializeDataUpdates();
});

// Routes
app.use('/api', chainRoutes);
app.use('/api', tvlRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Development-only middleware
if (isDevelopment) {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
    next();
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  // Send proper JSON response
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
    path: req.path
  });
});

// Add catch-all route for undefined routes
app.use('*', (req, res) => {
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
if (process.env.NODE_ENV !== 'production') {
    const server = app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Try accessing: http://localhost:${PORT}/api/chains`);
    });

    // Add error handler for the server
    server.on('error', (error) => {
        console.error('Server error:', error);
    });
} else {
    // Add explicit handling for production
    const server = app.listen(PORT, () => {
        console.log(`Production server running on port ${PORT}`);
        console.log(`Try accessing: http://localhost:${PORT}/api/chains`);
    });

    server.on('error', (error) => {
        console.error('Production server error:', error);
    });
}
