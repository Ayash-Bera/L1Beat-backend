require('dotenv').config();
const express = require('express');
const cors = require('cors');
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
const updateRoutes = require('./routes/updateRoutes');

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

// Add API key middleware
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const validApiKey = process.env.UPDATE_API_KEY;

  if (!apiKey || apiKey !== validApiKey) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized"
    });
  }
  next();
};

// Single initialization point for data updates
const initializeDataUpdates = async () => {
  console.log(`[${process.env.NODE_ENV}] Initializing data...`);
  try {
    await fetchAndUpdateData();
  } catch (error) {
    console.error('Initialization error:', error);
  }
};

// Call initialization after DB connection
connectDB().then(() => {
  initializeDataUpdates();
});

// Routes
app.use('/api', chainRoutes);
app.use('/api', tvlRoutes);
app.use('/api', tpsRoutes);
app.use('/api', updateRoutes);

// Add test endpoint
app.get('/api/test', validateApiKey, (req, res) => {
  res.json({
    success: true,
    message: "API is working correctly"
  });
});

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
