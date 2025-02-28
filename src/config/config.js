/**
 * Central configuration module
 * All configuration values should be defined here
 */
const config = {
  // Environment
  env: process.env.NODE_ENV || 'development',
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
  
  // Server
  server: {
    port: parseInt(process.env.PORT || '5001'),
    host: process.env.HOST || '0.0.0.0',
  },
  
  // Database
  db: {
    uri: process.env.NODE_ENV === 'production' 
      ? process.env.PROD_MONGODB_URI 
      : process.env.DEV_MONGODB_URI,
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  },
  
  // API Keys
  apiKeys: {
    admin: process.env.ADMIN_API_KEY,
    update: process.env.UPDATE_API_KEY
  },
  
  // External APIs
  api: {
    glacier: {
      baseUrl: process.env.GLACIER_API_BASE || 'https://glacier-api.avax.network/v1',
      timeout: parseInt(process.env.GLACIER_API_TIMEOUT || '30000')
    },
    popsicle: {
      baseUrl: process.env.POPSICLE_API_BASE || 'https://popsicle-api.avax.network/v1',
      timeout: parseInt(process.env.POPSICLE_API_TIMEOUT || '15000')
    },
    defillama: {
      baseUrl: process.env.DEFILLAMA_API_BASE || 'https://api.llama.fi/v2',
      timeout: parseInt(process.env.DEFILLAMA_API_TIMEOUT || '30000')
    }
  },
  
  // CORS
  cors: {
    origin: process.env.NODE_ENV === 'development' 
      ? ['http://localhost:5173', 'http://localhost:4173'] 
      : ['https://l1beat.io', 'https://www.l1beat.io', 'http://localhost:4173', 'http://localhost:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 
      'Authorization', 
      'X-Requested-With', 
      'Accept', 
      'Origin',
      'Cache-Control'
    ]
  },
  
  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'development' ? 1000 : 100, // Higher limit in development
    standardHeaders: true,
    legacyHeaders: false,
    // Skip client IP validation when running behind a proxy
    validate: { xForwardedForHeader: false }
  },
  
  // Cron schedules
  cron: {
    tvlUpdate: '*/30 * * * *', // Every 30 minutes
    chainUpdate: '0 * * * *',   // Every hour
    tpsVerification: '*/15 * * * *', // Every 15 minutes
    teleporterUpdate: '0 * * * *' // Every hour
  },
  
  // Cache TTLs (in milliseconds)
  cache: {
    chains: 5 * 60 * 1000,      // 5 minutes
    tvlHistory: 15 * 60 * 1000, // 15 minutes
    tps: 5 * 60 * 1000,         // 5 minutes
    teleporter: 5 * 60 * 1000   // 5 minutes
  }
};

module.exports = config; 