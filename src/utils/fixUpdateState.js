require('dotenv').config();
const mongoose = require('mongoose');
const { TeleporterUpdateState, TeleporterMessage } = require('../models/teleporterMessage');
const config = require('../config/config');
const logger = require('../utils/logger');

async function fixUpdateState() {
  try {
    // Connect to the database
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.DEV_MONGODB_URI || process.env.PROD_MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find the weekly update state
    const updateState = await TeleporterUpdateState.findOne({ updateType: 'weekly' });
    
    if (!updateState) {
      console.log('No weekly update state found');
      return;
    }
    
    console.log('Current update state:', {
      state: updateState.state,
      startedAt: updateState.startedAt,
      lastUpdatedAt: updateState.lastUpdatedAt,
      progress: updateState.progress
    });
    
    // Find the most recent weekly data
    const recentData = await TeleporterMessage.findOne({ 
      dataType: 'weekly' 
    }).sort({ updatedAt: -1 });
    
    if (recentData) {
      console.log('Most recent weekly data:', {
        updatedAt: recentData.updatedAt,
        totalMessages: recentData.totalMessages
      });
      
      // If the update state is in_progress, mark it as completed
      if (updateState.state === 'in_progress') {
        console.log('Marking update state as completed');
        
        updateState.state = 'completed';
        updateState.lastUpdatedAt = new Date();
        updateState.progress = {
          currentDay: 8,
          totalDays: 7,
          daysCompleted: 7,
          messagesCollected: recentData.totalMessages
        };
        
        await updateState.save();
        console.log('Update state marked as completed');
      }
    } else {
      console.log('No weekly data found');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Disconnect from the database
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the function
fixUpdateState(); 