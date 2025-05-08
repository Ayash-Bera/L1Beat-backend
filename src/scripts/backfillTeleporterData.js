/**
 * Script to backfill missing teleporter message data
 * This script analyzes the existing teleporter data and fills in gaps by fetching
 * historical data from the Glacier API for days that are missing.
 * 
 * Usage: node src/scripts/backfillTeleporterData.js --days=30 --db=mongodb://localhost:27017/l1beat
 */

// Load environment variables first before other imports
require('dotenv').config();

const mongoose = require('mongoose');
const config = require('../config/config');
const { TeleporterMessage } = require('../models/teleporterMessage');
const teleporterService = require('../services/teleporterService');
const logger = require('../utils/logger');

// Parse command line arguments
const args = process.argv.slice(2).reduce((result, arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  result[key] = value;
  return result;
}, {});

const days = parseInt(args.days || 30);
const dbUri = args.db; // Optional DB URI from command line

/**
 * Connect to the database
 */
async function connectDatabase() {
  try {
    // Use DB URI in this priority: command line arg > config > environment variables
    const connectionUri = dbUri || config.db.uri;
    
    // Check if the database URI is defined
    if (!connectionUri) {
      logger.error('Database URI is undefined. Make sure your environment variables are set correctly.');
      logger.info('You can specify the database URI directly: node src/scripts/backfillTeleporterData.js --days=30 --db=mongodb://username:password@localhost:27017/dbname');
      
      // Use fallback URI if available in environment
      const fallbackUri = process.env.MONGODB_URI || process.env.DB_URI || process.env.DATABASE_URL;
      if (fallbackUri) {
        logger.info(`Attempting to use fallback database URI from environment variables`);
        await mongoose.connect(fallbackUri, config.db.options);
        logger.info('Database connection established using fallback URI');
        return true;
      }
      
      // Print connection example
      logger.info('Examples:');
      logger.info('  Local: --db=mongodb://localhost:27017/l1beat');
      logger.info('  Atlas: --db=mongodb+srv://username:password@cluster.mongodb.net/l1beat');
      
      return false;
    }
    
    logger.info(`Connecting to database at ${connectionUri}`);
    await mongoose.connect(connectionUri, config.db.options);
    logger.info('Database connection established');
    return true;
  } catch (error) {
    logger.error('Failed to connect to database:', { error: error.message });
    return false;
  }
}

/**
 * Find missing dates in the teleporter data
 * @param {number} days - Number of days to check
 * @returns {Promise<Array>} Array of missing dates (as Date objects)
 */
async function findMissingDates(days) {
  // Get all daily teleporter data
  const existingData = await TeleporterMessage.find({
    dataType: 'daily'
  }).sort({ updatedAt: -1 });
  
  // Create a map of existing dates (YYYY-MM-DD)
  const existingDates = {};
  existingData.forEach(record => {
    const date = new Date(record.updatedAt);
    const dateStr = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
    existingDates[dateStr] = true;
  });
  
  // Find the most recent date
  const mostRecentDate = existingData.length > 0 ? new Date(existingData[0].updatedAt) : new Date();
  
  // Check for missing dates in the specified range
  const missingDates = [];
  for (let i = 0; i < days; i++) {
    const currentDate = new Date(mostRecentDate);
    currentDate.setDate(mostRecentDate.getDate() - i);
    
    const dateStr = `${currentDate.getFullYear()}-${(currentDate.getMonth()+1).toString().padStart(2, '0')}-${currentDate.getDate().toString().padStart(2, '0')}`;
    
    // If this date doesn't exist in our database, add it to the missing dates
    if (!existingDates[dateStr]) {
      missingDates.push({
        date: new Date(currentDate),
        dateString: dateStr
      });
    }
  }
  
  return missingDates;
}

/**
 * Fetch and store teleporter data for a specific date
 * @param {Date} date - Date to fetch data for
 * @returns {Promise<boolean>} Success status
 */
async function backfillDateData(date) {
  try {
    // Calculate time range for the day (in hours ago from now)
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    
    // We need to fetch a 24-hour window
    const startHoursAgo = diffHours + 24; // Start 24 hours before the end of the target day
    const endHoursAgo = diffHours;        // End at the end of the target day
    
    logger.info(`Fetching data for ${date.toISOString().split('T')[0]} (${endHoursAgo}-${startHoursAgo} hours ago)`);
    
    // Fetch messages for this time range
    const result = await teleporterService.fetchTeleporterMessagesWithTimeRange(startHoursAgo, endHoursAgo);
    
    if (result.messages.length === 0) {
      logger.warn(`No messages found for ${date.toISOString().split('T')[0]}`);
      return false;
    }
    
    // Process the messages
    const processedData = await teleporterService.processMessages(result.messages);
    
    // Create a timestamp at the end of the target day
    const timestamp = new Date(date);
    timestamp.setHours(23, 59, 59, 999);
    
    // Save the data to the database
    const teleporterData = new TeleporterMessage({
      updatedAt: timestamp,
      messageCounts: processedData,
      totalMessages: result.messages.length,
      timeWindow: 24,
      dataType: 'daily'
    });
    
    await teleporterData.save();
    
    logger.info(`Saved teleporter data for ${date.toISOString().split('T')[0]} with ${processedData.length} chain pairs and ${result.messages.length} total messages`);
    return true;
  } catch (error) {
    logger.error(`Error backfilling data for ${date.toISOString().split('T')[0]}:`, { 
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}

/**
 * Main function to run the backfill
 */
async function main() {
  try {
    // Connect to the database
    const connected = await connectDatabase();
    if (!connected) {
      process.exit(1);
    }
    
    // Find missing dates
    const missingDates = await findMissingDates(days);
    
    if (missingDates.length === 0) {
      logger.info(`No missing dates found in the last ${days} days`);
      await mongoose.connection.close();
      return;
    }
    
    logger.info(`Found ${missingDates.length} missing dates: ${missingDates.map(d => d.dateString).join(', ')}`);
    
    // Backfill each missing date
    let successCount = 0;
    for (const { date, dateString } of missingDates) {
      logger.info(`Processing missing date: ${dateString}`);
      const success = await backfillDateData(date);
      
      if (success) {
        successCount++;
      }
      
      // Add a delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    logger.info(`Backfill complete. Successfully backfilled ${successCount}/${missingDates.length} dates.`);
    
    // Close the database connection
    await mongoose.connection.close();
    
  } catch (error) {
    logger.error('Error in backfill process:', { error: error.message, stack: error.stack });
    
    // Ensure database connection is closed
    try {
      await mongoose.connection.close();
    } catch (err) {
      // Ignore
    }
    
    process.exit(1);
  }
}

// Run the script
main(); 