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
        
        // Get the most recent data from the database
        const recentData = await teleporterService.getAnyMessageCountFromDB('weekly');
        
        // Check if an update is in progress
        let updateState = await TeleporterUpdateState.findOne({ 
            updateType: 'weekly'
        });
        
        // Determine if we need to trigger an update
        let updateTriggered = false;
        
        // If we have no data or data is older than 24 hours, and no update is in progress, trigger an update
        if ((!recentData || (Date.now() - new Date(recentData.updatedAt).getTime() > 24 * 60 * 60 * 1000)) && 
            (!updateState || updateState.state !== 'in_progress')) {
            
            logger.info('Weekly data is missing or older than 24 hours, triggering background update');
            
            // Trigger the update in the background using the new method that fetches all data at once
            teleporterService.fetchWeeklyTeleporterDataAtOnce().catch(err => {
                logger.error('Error during automatic weekly data update:', {
                    message: err.message,
                    stack: err.stack
                });
            });
            
            updateTriggered = true;
            logger.info('Weekly data update has been triggered in the background');
        }
        // If we have stale update state, fix it
        else if (updateState && updateState.state === 'in_progress') {
            // Check if the update state is stale (hasn't been updated in 5 minutes)
            const lastUpdated = new Date(updateState.lastUpdatedAt);
            const timeSinceUpdate = new Date().getTime() - lastUpdated.getTime();
            
            // If the update is stale or if the data is newer than the update state, mark it as failed
            if (timeSinceUpdate > 5 * 60 * 1000 || 
                (recentData && recentData.updatedAt && new Date(recentData.updatedAt) > new Date(updateState.startedAt))) {
                logger.info('Found stale or inconsistent update state, marking as failed', {
                    updateStateLastUpdated: lastUpdated.toISOString(),
                    dataUpdatedAt: recentData ? recentData.updatedAt.toISOString() : 'No data',
                    timeSinceUpdateMs: timeSinceUpdate
                });
                
                // Update the state to failed
                updateState.state = 'failed';
                updateState.lastUpdatedAt = new Date();
                updateState.error = {
                    message: 'Update timed out',
                    details: `No updates for ${Math.round(timeSinceUpdate / 1000 / 60)} minutes`
                };
                await updateState.save();
                
                // If data is very old, trigger a new update
                if (!recentData || (Date.now() - new Date(recentData.updatedAt).getTime() > 24 * 60 * 60 * 1000)) {
                    logger.info('Weekly data is missing or older than 24 hours, triggering new background update');
                    
                    // Trigger the update in the background using the new method that fetches all data at once
                    teleporterService.fetchWeeklyTeleporterDataAtOnce().catch(err => {
                        logger.error('Error during automatic weekly data update:', {
                            message: err.message,
                            stack: err.stack
                        });
                    });
                    
                    updateTriggered = true;
                    logger.info('Weekly data update has been triggered in the background');
                }
            }
        }
        
        // Get the message count data (this will use cached data if available)
        const messageCount = await teleporterService.getWeeklyCrossChainMessageCount();
        
        logger.info('Weekly cross-chain message count fetched:', {
            count: messageCount.length,
            totalMessages: messageCount.reduce((sum, item) => sum + item.messageCount, 0),
            updateInProgress: updateState?.state === 'in_progress',
            updateTriggered
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
                    progress: progress
                };
                
                logger.info('Including update status in response', {
                    state: updateState.state,
                    startedAt: updateState.startedAt,
                    lastUpdatedAt: updateState.lastUpdatedAt,
                    timeSinceUpdateMs: timeSinceUpdate
                });
            }
        }
        
        // If we triggered an update, include that in the response
        if (updateTriggered) {
            response.metadata.updateTriggered = true;
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