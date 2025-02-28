const teleporterService = require('../services/teleporterService');
const logger = require('../utils/logger');
const { TeleporterUpdateState } = require('../models/teleporterMessage');

/**
 * Get daily cross-chain message count
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getDailyCrossChainMessageCount = async (req, res) => {
    try {
        logger.info('Fetching daily cross-chain message count...');
        const messageCount = await teleporterService.getDailyCrossChainMessageCount();
        
        // Get the most recent data from the database to include metadata
        const recentData = await teleporterService.getAnyMessageCountFromDB('daily');
        
        logger.info('Daily cross-chain message count fetched:', {
            count: messageCount.length,
            totalMessages: messageCount.reduce((sum, item) => sum + item.messageCount, 0)
        });
        
        // Ensure we're working with plain objects, not Mongoose documents
        const plainData = messageCount.map(item => {
            // Convert to plain object if it's a Mongoose document
            const plainItem = item.toObject ? item.toObject() : item;
            // Remove _id field
            const { _id, ...dataWithoutId } = plainItem;
            return dataWithoutId;
        });
        
        // Create response with metadata
        const response = {
            data: plainData,
            metadata: {
                totalMessages: recentData ? recentData.totalMessages : 0,
                timeWindow: recentData ? recentData.timeWindow : 24,
                timeWindowUnit: 'hours',
                updatedAt: recentData ? recentData.updatedAt : new Date()
            }
        };
        
        res.json(response);
    } catch (error) {
        logger.error('Error in getDailyCrossChainMessageCount:', {
            message: error.message,
            stack: error.stack
        });
        
        res.status(500).json({ 
            error: 'Failed to fetch cross-chain message count',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

/**
 * Get weekly cross-chain message count (last 7 days)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getWeeklyCrossChainMessageCount = async (req, res) => {
    try {
        logger.info('Fetching weekly cross-chain message count (last 7 days)...');
        const messageCount = await teleporterService.getWeeklyCrossChainMessageCount();
        
        // Get the most recent data from the database to include metadata
        const recentData = await teleporterService.getAnyMessageCountFromDB('weekly');
        
        // Check if an update is in progress
        let updateState = await TeleporterUpdateState.findOne({ 
            updateType: 'weekly'
        });
        
        // If we have recent data and the update state is stale or inconsistent, fix it
        if (recentData && updateState && updateState.state === 'in_progress') {
            // Check if the update state is stale (hasn't been updated in 5 minutes)
            const lastUpdated = new Date(updateState.lastUpdatedAt);
            const timeSinceUpdate = new Date().getTime() - lastUpdated.getTime();
            
            // If the update is stale or if the data is newer than the update state, mark it as completed
            if (timeSinceUpdate > 5 * 60 * 1000 || 
                (recentData.updatedAt && new Date(recentData.updatedAt) > new Date(updateState.startedAt))) {
                logger.info('Found stale or inconsistent update state, marking as completed', {
                    updateStateLastUpdated: lastUpdated.toISOString(),
                    dataUpdatedAt: recentData.updatedAt.toISOString(),
                    timeSinceUpdateMs: timeSinceUpdate
                });
                
                // Update the state to completed
                updateState.state = 'completed';
                updateState.lastUpdatedAt = new Date();
                updateState.progress = {
                    currentDay: 8,
                    totalDays: 7,
                    daysCompleted: 7,
                    messagesCollected: recentData.totalMessages
                };
                await updateState.save();
            }
        }
        
        logger.info('Weekly cross-chain message count fetched:', {
            count: messageCount.length,
            totalMessages: messageCount.reduce((sum, item) => sum + item.messageCount, 0),
            updateInProgress: updateState?.state === 'in_progress'
        });
        
        // Ensure we're working with plain objects, not Mongoose documents
        const plainData = messageCount.map(item => {
            // Convert to plain object if it's a Mongoose document
            const plainItem = item.toObject ? item.toObject() : item;
            // Remove _id field
            const { _id, ...dataWithoutId } = plainItem;
            return dataWithoutId;
        });
        
        // Create response with metadata
        const response = {
            data: plainData,
            metadata: {
                totalMessages: recentData ? recentData.totalMessages : 0,
                timeWindow: recentData ? recentData.timeWindow : 168,
                timeWindowUnit: 'hours',
                updatedAt: recentData ? recentData.updatedAt : new Date()
            }
        };
        
        // Add update status information if available and in progress
        // Only include if the update is actually making progress (has been updated recently)
        if (updateState && updateState.state === 'in_progress') {
            const lastUpdated = new Date(updateState.lastUpdatedAt);
            const timeSinceUpdate = new Date().getTime() - lastUpdated.getTime();
            
            // Only include update status if it's been updated in the last 5 minutes
            if (timeSinceUpdate < 5 * 60 * 1000) {
                // Ensure progress object has all required fields
                const progress = updateState.progress || {};
                
                response.metadata.updateStatus = {
                    state: updateState.state,
                    startedAt: updateState.startedAt,
                    lastUpdatedAt: updateState.lastUpdatedAt,
                    progress: {
                        currentDay: progress.currentDay || 1,
                        totalDays: progress.totalDays || 7,
                        daysCompleted: progress.daysCompleted || 0,
                        messagesCollected: progress.messagesCollected || 0
                    }
                };
                
                logger.info('Including update status in response', {
                    state: updateState.state,
                    startedAt: updateState.startedAt,
                    lastUpdatedAt: updateState.lastUpdatedAt,
                    timeSinceUpdateMs: timeSinceUpdate
                });
            } else {
                // If the update is stale, mark it as failed but don't include it in the response
                logger.warn('Found stale update state, marking as failed but not including in response', {
                    lastUpdated: lastUpdated.toISOString(),
                    timeSinceUpdateMs: timeSinceUpdate
                });
                
                updateState.state = 'failed';
                updateState.lastUpdatedAt = new Date();
                updateState.error = {
                    message: 'Update timed out',
                    details: `No updates for ${Math.round(timeSinceUpdate / 1000 / 60)} minutes`
                };
                await updateState.save();
            }
        }
        
        res.json(response);
    } catch (error) {
        logger.error('Error in getWeeklyCrossChainMessageCount:', {
            message: error.message,
            stack: error.stack
        });
        
        res.status(500).json({ 
            error: 'Failed to fetch weekly cross-chain message count',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}; 