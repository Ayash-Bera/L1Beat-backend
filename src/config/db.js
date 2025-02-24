const mongoose = require('mongoose');
const config = require('./config');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    const dbURI = config.db.uri;

    if (!dbURI) {
      throw new Error('MongoDB URI is not defined in environment variables');
    }

    logger.info(`Attempting to connect to MongoDB (${config.env} environment)`);
    
    const conn = await mongoose.connect(dbURI, config.db.options);
    
    logger.info(`MongoDB Connected: ${conn.connection.host} (${config.env} environment)`);
    
    // Test write permissions
    try {
      await mongoose.connection.db.command({ ping: 1 });
      logger.info('MongoDB write permission test successful');
    } catch (error) {
      logger.error('MongoDB write permission test failed:', error);
    }
    
  } catch (error) {
    logger.error(`MongoDB Connection Error: ${error.message}`, { stack: error.stack });
    process.exit(1);
  }
};

module.exports = connectDB;
