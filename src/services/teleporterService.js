const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');
const Chain = require('../models/chain');
const { TeleporterMessage, TeleporterUpdateState } = require('../models/teleporterMessage');

class TeleporterService {
    constructor() {
        this.GLACIER_API_BASE = config.api.glacier.baseUrl;
        this.MAX_PAGES = 100; // Increased from 50 to 100 to handle high-volume periods
        this.MAX_RETRIES = 5; // Increased from 3 to 5 for better handling of timeout issues
        this.INITIAL_BACKOFF = 5000; // Increased from 3000 to 5000 ms for initial backoff
        this.PAGE_SIZE = 50; // Reduced from 100 to 50 to reduce likelihood of timeouts
        this.REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds
    }

    /**
     * Sleep for a specified duration
     * @param {number} ms - Time to sleep in milliseconds
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Fetches teleporter messages from the Glacier API with retry and backoff
     * @param {number} timeWindow - Time window in hours to fetch messages for
     * @returns {Promise<Object>} Object with messages array and hitPageLimit flag
     */
    async fetchTeleporterMessages(timeWindow = 24) {
        try {
            logger.info(`Fetching teleporter messages from Glacier API for the last ${timeWindow} hours with pageSize=${this.PAGE_SIZE}...`);
            
            // Calculate timestamp for the specified time window
            const now = Math.floor(Date.now() / 1000);
            const startTime = now - (timeWindow * 60 * 60);
            
            // Call fetchTeleporterMessagesWithTimeRange with proper parameters
            // startHoursAgo = timeWindow, endHoursAgo = 0 (now)
            return await this.fetchTeleporterMessagesWithTimeRange(timeWindow, 0);
        } catch (error) {
            // Safely log error without circular references
            logger.error('Error fetching teleporter messages:', {
                message: error.message,
                code: error.code,
                status: error.response?.status,
                statusText: error.response?.statusText
            });
            throw error;
        }
    }

    /**
     * Fetches teleporter messages from the Glacier API for a specific time range
     * @param {number} startHoursAgo - Start time in hours ago
     * @param {number} endHoursAgo - End time in hours ago
     * @returns {Promise<Object>} Object with messages array and hitPageLimit flag
     */
    async fetchTeleporterMessagesWithTimeRange(startHoursAgo, endHoursAgo) {
        try {
            logger.info(`Fetching teleporter messages from ${startHoursAgo} to ${endHoursAgo} hours ago with pageSize=${this.PAGE_SIZE}...`);
            
            // Calculate timestamps
            const now = Math.floor(Date.now() / 1000);
            const startTime = now - (startHoursAgo * 60 * 60);
            const endTime = endHoursAgo > 0 ? now - (endHoursAgo * 60 * 60) : now;
            
            let allMessages = [];
            let nextPageToken = null;
            let pageCount = 0;
            let hitPageLimit = false;
            let reachedTimeLimit = false;
            
            // Fetch pages until there are no more or we hit the limit
            do {
                pageCount++;
                let retryCount = 0;
                let success = false;
                
                // Retry logic with exponential backoff
                while (!success && retryCount <= this.MAX_RETRIES) {
                    try {
                        // Add delay for subsequent requests or retries
                        if (nextPageToken || retryCount > 0) {
                            const backoffTime = retryCount === 0 
                                ? 2000 // Standard delay between pages
                                : this.INITIAL_BACKOFF * Math.pow(2, retryCount - 1); // Exponential backoff
                            
                            logger.info(`Waiting ${backoffTime}ms before ${retryCount > 0 ? 'retry' : 'fetching next page'}...`);
                            await this.sleep(backoffTime);
                        }
                        
                        // Prepare request parameters
                        const params = {
                            startTime,
                            endTime,
                            pageSize: this.PAGE_SIZE, // Use maximum page size to reduce number of API calls
                            network: 'mainnet' // Filter for mainnet chains only
                        };
                        
                        // Add page token if we have one
                        if (nextPageToken) {
                            params.pageToken = nextPageToken;
                            logger.info(`Fetching page ${pageCount} with token: ${nextPageToken}`);
                        }
                        
                        const response = await axios.get(`${this.GLACIER_API_BASE}/teleporter/messages`, {
                            params,
                            timeout: config.api.glacier.timeout,
                            headers: {
                                'Accept': 'application/json',
                                'User-Agent': 'l1beat-backend'
                            }
                        });
                        
                        logger.info('Glacier API Teleporter Response:', {
                            status: response.status,
                            page: pageCount,
                            retry: retryCount,
                            messageCount: response.data?.messages?.length || 0,
                            hasNextPage: !!response.data?.nextPageToken,
                            timeRange: `${startHoursAgo}-${endHoursAgo} hours ago`
                        });
            
                        if (!response.data || !response.data.messages) {
                            throw new Error('Invalid response from Glacier API Teleporter endpoint');
                        }
                        
                        // Log the structure of the first message to understand its format
                        if (response.data.messages.length > 0 && pageCount === 1) {
                            const sampleMessage = response.data.messages[0];
                            logger.info('Sample message structure:', {
                                keys: Object.keys(sampleMessage),
                                hasTimestamp: !!sampleMessage.timestamp,
                                timestampType: sampleMessage.timestamp ? typeof sampleMessage.timestamp : 'undefined',
                                timestampValue: sampleMessage.timestamp,
                                otherTimeFields: {
                                    createdAt: sampleMessage.createdAt,
                                    created_at: sampleMessage.created_at,
                                    time: sampleMessage.time,
                                    date: sampleMessage.date
                                },
                                sourceTransaction: sampleMessage.sourceTransaction ? {
                                    hasTimestamp: !!sampleMessage.sourceTransaction.timestamp,
                                    timestampType: sampleMessage.sourceTransaction.timestamp ? typeof sampleMessage.sourceTransaction.timestamp : 'undefined',
                                    timestampValue: sampleMessage.sourceTransaction.timestamp,
                                    keys: Object.keys(sampleMessage.sourceTransaction)
                                } : null,
                                destinationTransaction: sampleMessage.destinationTransaction ? {
                                    hasTimestamp: !!sampleMessage.destinationTransaction.timestamp,
                                    timestampType: sampleMessage.destinationTransaction.timestamp ? typeof sampleMessage.destinationTransaction.timestamp : 'undefined',
                                    timestampValue: sampleMessage.destinationTransaction.timestamp,
                                    keys: Object.keys(sampleMessage.destinationTransaction)
                                } : null
                            });
                        }
                        
                        // Check if any messages are older than our time window
                        // The API should return messages in descending order by timestamp
                        const messages = response.data.messages;
                        let validMessages = [];
                        
                        for (const message of messages) {
                            // Check if the message timestamp is within our time range
                            // Try to get timestamp from various possible locations
                            let messageTimestamp = null;
                            
                            // First check direct timestamp properties
                            if (message.timestamp) {
                                messageTimestamp = message.timestamp;
                            } else if (message.createdAt) {
                                messageTimestamp = message.createdAt;
                            } else if (message.created_at) {
                                messageTimestamp = message.created_at;
                            } 
                            // Then check transaction timestamps
                            else if (message.sourceTransaction && message.sourceTransaction.timestamp) {
                                messageTimestamp = message.sourceTransaction.timestamp;
                                logger.debug('Using sourceTransaction timestamp', {
                                    messageId: message.messageId || 'unknown',
                                    timestamp: messageTimestamp
                                });
                            } else if (message.destinationTransaction && message.destinationTransaction.timestamp) {
                                messageTimestamp = message.destinationTransaction.timestamp;
                                logger.debug('Using destinationTransaction timestamp', {
                                    messageId: message.messageId || 'unknown',
                                    timestamp: messageTimestamp
                                });
                            }
                            
                            if (!messageTimestamp) {
                                logger.warn('Message missing timestamp property:', {
                                    messageId: message.messageId || 'unknown',
                                    messageKeys: Object.keys(message),
                                    hasSourceTx: !!message.sourceTransaction,
                                    hasDestTx: !!message.destinationTransaction,
                                    sourceTxKeys: message.sourceTransaction ? Object.keys(message.sourceTransaction) : [],
                                    destTxKeys: message.destinationTransaction ? Object.keys(message.destinationTransaction) : []
                                });
                                // Include the message anyway since we can't determine its age
                                validMessages.push(message);
                                continue;
                            }
                            
                            // Convert timestamp to seconds if it's in milliseconds
                            const timestampInSeconds = messageTimestamp > 1000000000000 
                                ? Math.floor(messageTimestamp / 1000) 
                                : messageTimestamp;
                            
                            if (timestampInSeconds >= startTime) {
                                validMessages.push(message);
                            } else {
                                reachedTimeLimit = true;
                                logger.info(`Found message older than ${startHoursAgo} hours, stopping pagination`, {
                                    messageTimestamp: new Date(timestampInSeconds * 1000).toISOString(),
                                    startTime: new Date(startTime * 1000).toISOString(),
                                    page: pageCount,
                                    messageId: message.messageId || 'unknown'
                                });
                            }
                        }
                        
                        // Add valid messages from this page to our collection
                        allMessages = [...allMessages, ...validMessages];
                        
                        // If we reached the time limit, stop pagination
                        if (reachedTimeLimit) {
                            logger.info(`Reached time limit (${startHoursAgo} hours), stopping pagination`);
                            break;
                        }
                        
                        // Get the next page token
                        nextPageToken = response.data.nextPageToken;
                        
                        // Mark as successful
                        success = true;
                        
                    } catch (error) {
                        // Handle rate limiting with retry
                        if (error.response && error.response.status === 429) {
                            retryCount++;
                            logger.warn(`Rate limited by Glacier API (attempt ${retryCount}/${this.MAX_RETRIES})`, {
                                page: pageCount,
                                messagesCollected: allMessages.length
                            });
                            
                            if (retryCount > this.MAX_RETRIES) {
                                logger.error('Max retries exceeded for rate limiting');
                                break;
                            }
                        } else if (error.code === 'ECONNABORTED') {
                            // Handle timeout errors
                            retryCount++;
                            logger.warn(`Timeout error with Glacier API (attempt ${retryCount}/${this.MAX_RETRIES})`, {
                                page: pageCount,
                                messagesCollected: allMessages.length,
                                error: error.message,
                                timeout: config.api.glacier.timeout
                            });
                            
                            if (retryCount > this.MAX_RETRIES) {
                                logger.error(`Max retries exceeded for timeout error`);
                                break;
                            }
                        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                            // Handle network connectivity issues
                            retryCount++;
                            logger.warn(`Network connectivity issue with Glacier API (attempt ${retryCount}/${this.MAX_RETRIES}): ${error.code}`, {
                                page: pageCount,
                                messagesCollected: allMessages.length,
                                error: error.message
                            });
                            
                            if (retryCount > this.MAX_RETRIES) {
                                logger.error(`Max retries exceeded for network issue: ${error.code}`);
                                break;
                            }
                        } else {
                            // For other errors, don't retry
                            logger.error('Error fetching teleporter messages:', {
                                message: error.message,
                                code: error.code,
                                status: error.response?.status,
                                statusText: error.response?.statusText
                            });
                            throw error;
                        }
                    }
                }
                
                // If we couldn't successfully fetch this page after retries, stop pagination
                if (!success) {
                    break;
                }
                
                // If we reached the time limit, stop pagination
                if (reachedTimeLimit) {
                    break;
                }
                
                // Stop if we've reached the maximum number of pages (safety limit)
                if (pageCount >= this.MAX_PAGES) {
                    logger.warn(`Reached maximum page limit (${this.MAX_PAGES}), stopping pagination`, {
                        timeRange: `${startHoursAgo}-${endHoursAgo} hours ago`,
                        messagesCollected: allMessages.length,
                        pageSize: this.PAGE_SIZE,
                        totalPagesRetrieved: pageCount
                    });
                    hitPageLimit = true;
                    
                    // If we hit the page limit and the time window is larger than 2 hours,
                    // we'll split the time window and recursively fetch in smaller chunks
                    const timeWindowHours = startHoursAgo - endHoursAgo;
                    if (timeWindowHours > 2) {
                        logger.warn(`Time window (${timeWindowHours} hours) is large, splitting into smaller chunks to handle high volume`);
                        
                        // Split the time window in half
                        const midPoint = endHoursAgo + Math.ceil(timeWindowHours / 2);
                        
                        logger.warn(`Splitting time window: ${startHoursAgo}-${midPoint} and ${midPoint}-${endHoursAgo} hours ago`);
                        
                        // Fetch the first half
                        const firstHalfResult = await this.fetchTeleporterMessagesWithTimeRange(
                            startHoursAgo,
                            midPoint
                        );
                        
                        // Add a delay before fetching the second half
                        await this.sleep(5000);
                        
                        // Fetch the second half
                        const secondHalfResult = await this.fetchTeleporterMessagesWithTimeRange(
                            midPoint,
                            endHoursAgo
                        );
                        
                        // Combine the results
                        allMessages = [
                            ...firstHalfResult.messages,
                            ...secondHalfResult.messages
                        ];
                        
                        hitPageLimit = firstHalfResult.hitPageLimit || secondHalfResult.hitPageLimit;
                        reachedTimeLimit = firstHalfResult.reachedTimeLimit || secondHalfResult.reachedTimeLimit;
                        
                        logger.info(`Combined results from split time windows:`, {
                            totalMessages: allMessages.length,
                            firstHalfMessages: firstHalfResult.messages.length,
                            secondHalfMessages: secondHalfResult.messages.length,
                            hitPageLimit,
                            reachedTimeLimit
                        });
                    }
                    
                    break;
                }
                
            } while (nextPageToken);
            
            logger.info(`Completed fetching teleporter messages, total: ${allMessages.length} from ${pageCount} pages`, {
                hitPageLimit,
                reachedTimeLimit,
                timeRange: `${startHoursAgo}-${endHoursAgo} hours ago`
            });
            
            return {
                messages: allMessages,
                hitPageLimit,
                reachedTimeLimit
            };
            
        } catch (error) {
            // Safely log error without circular references
            logger.error('Error fetching teleporter messages with time range:', {
                message: error.message,
                code: error.code,
                status: error.response?.status,
                statusText: error.response?.statusText,
                timeRange: `${startHoursAgo}-${endHoursAgo} hours ago`
            });
            throw error;
        }
    }

    /**
     * Update teleporter data in the database
     * This method is called by the cron job
     * @returns {Promise<void>}
     */
    async updateTeleporterData() {
        try {
            logger.info('Starting daily teleporter data update...');
            
            // Get the current time
            const now = new Date();
            
            // Create or update the update state
            let updateState = await TeleporterUpdateState.findOne({ updateType: 'daily' });
            if (!updateState) {
                updateState = new TeleporterUpdateState({
                    updateType: 'daily',
                    state: 'in_progress',
                    startedAt: now,
                    lastUpdatedAt: now
                });
            } else {
                updateState.state = 'in_progress';
                updateState.startedAt = now;
                updateState.lastUpdatedAt = now;
                updateState.error = null;
                updateState.progress = {
                    currentChunk: 0,
                    totalChunks: 6, // 6 chunks of 4 hours each
                    messagesCollected: 0
                };
            }
            await updateState.save();
            
            // We'll fetch the last 24 hours of data in 4-hour chunks
            const HOURS_PER_CHUNK = 4;
            const TOTAL_CHUNKS = 6; // 24 hours / 4 hours per chunk
            
            let allMessages = [];
            let chunkErrors = [];
            
            for (let i = 0; i < TOTAL_CHUNKS; i++) {
                try {
                    const startHours = 24 - (i * HOURS_PER_CHUNK);
                    const endHours = startHours - HOURS_PER_CHUNK;
                    
                    logger.info(`Fetching chunk ${i+1}/${TOTAL_CHUNKS}: ${startHours}-${endHours} hours ago`);
                    
                    // Update the state to show which chunk we're processing
                    updateState.progress = {
                        currentChunk: i + 1,
                        totalChunks: TOTAL_CHUNKS,
                        messagesCollected: allMessages.length
                    };
                    updateState.lastUpdatedAt = new Date();
                    await updateState.save();
                    
                    // Fetch messages for this time chunk
                    const result = await this.fetchTeleporterMessagesWithTimeRange(startHours, endHours);
                    
                    // Add messages from this chunk to our collection
                    allMessages = [...allMessages, ...result.messages];
                    
                    logger.info(`Completed chunk ${i+1}/${TOTAL_CHUNKS}, collected ${result.messages.length} messages`, {
                        hitPageLimit: result.hitPageLimit,
                        reachedTimeLimit: result.reachedTimeLimit,
                        totalMessages: allMessages.length
                    });
                    
                    // If we hit the page limit, log a warning
                    if (result.hitPageLimit) {
                        logger.warn(`Hit page limit in chunk ${i+1}/${TOTAL_CHUNKS}, some messages may be missing`);
                    }
                    
                    // Add a delay before fetching the next chunk to avoid rate limiting
                    if (i < TOTAL_CHUNKS - 1) {
                        await this.sleep(8000);
                    }
                    
                } catch (error) {
                    // Log the error but continue with the next chunk
                    logger.error(`Error processing chunk ${i+1}/${TOTAL_CHUNKS}:`, {
                        message: error.message,
                        code: error.code,
                        status: error.response?.status
                    });
                    
                    chunkErrors.push({
                        chunk: i + 1,
                        error: error.message,
                        timestamp: new Date()
                    });
                    
                    // Add a longer delay after an error
                    await this.sleep(10000);
                }
            }
            
            // Process the collected messages
            if (allMessages.length > 0) {
                logger.info(`Processing ${allMessages.length} teleporter messages...`);
                
                // Process the messages to get counts by source and destination
                const processedData = await this.processMessages(allMessages);
                
                // Save the processed data to the database
                const teleporterData = new TeleporterMessage({
                    updatedAt: new Date(),
                    messageCounts: processedData,
                    totalMessages: allMessages.length,
                    timeWindow: 24, // 24 hours
                    dataType: 'daily'
                });
                
                await teleporterData.save();
                
                logger.info(`Saved daily teleporter data with ${processedData.length} chain pairs and ${allMessages.length} total messages`);
                
                // Update the state to completed
                updateState.state = 'completed';
                updateState.lastUpdatedAt = new Date();
                updateState.progress = {
                    currentChunk: TOTAL_CHUNKS,
                    totalChunks: TOTAL_CHUNKS,
                    messagesCollected: allMessages.length
                };
                
                if (chunkErrors.length > 0) {
                    updateState.error = {
                        message: `Completed with ${chunkErrors.length} chunk errors`,
                        details: chunkErrors
                    };
                } else {
                    updateState.error = null;
                }
                
                await updateState.save();
                
                return {
                    success: true,
                    messageCount: processedData.length,
                    totalMessages: allMessages.length
                };
            } else {
                logger.warn('No teleporter messages found in the last 24 hours');
                
                // Update the state to failed
                updateState.state = 'failed';
                updateState.lastUpdatedAt = new Date();
                updateState.error = {
                    message: 'No messages found',
                    details: chunkErrors.length > 0 ? chunkErrors : null
                };
                await updateState.save();
                
                return {
                    success: false,
                    error: 'No messages found'
                };
            }
        } catch (error) {
            logger.error('Error updating teleporter data:', {
                message: error.message,
                stack: error.stack
            });
            
            // Update the state to failed
            try {
                let updateState = await TeleporterUpdateState.findOne({ updateType: 'daily' });
                if (updateState) {
                    updateState.state = 'failed';
                    updateState.lastUpdatedAt = new Date();
                    updateState.error = {
                        message: error.message,
                        stack: error.stack
                    };
                    await updateState.save();
                }
            } catch (stateError) {
                logger.error('Error updating state:', stateError);
            }
            
            throw error;
        }
    }

    /**
     * Processes teleporter messages to get daily counts grouped by source and destination chains
     * @returns {Promise<Array>} Array of objects with sourceChain, destinationChain, and messageCount
     */
    async getDailyCrossChainMessageCount() {
        try {
            // Always prioritize database data
            const recentData = await this.getRecentMessageCountFromDB(this.REFRESH_INTERVAL, 'daily');
            
            if (recentData) {
                logger.info('Using recent teleporter message count data from database', {
                    updatedAt: recentData.updatedAt,
                    totalMessages: recentData.totalMessages,
                    timeWindow: recentData.timeWindow
                });
                return recentData.messageCounts;
            }
            
            // If no recent data, try to get any data from DB regardless of age
            logger.warn('No recent teleporter data in database, checking for any data');
            const anyData = await this.getAnyMessageCountFromDB('daily');
            
            if (anyData) {
                logger.info('Using older teleporter message count data from database', {
                    updatedAt: anyData.updatedAt,
                    totalMessages: anyData.totalMessages,
                    timeWindow: anyData.timeWindow,
                    age: Math.round((Date.now() - anyData.updatedAt) / (60 * 1000)) + ' minutes old'
                });
                
                // If data is older than 30 minutes, trigger a background update
                if (Date.now() - anyData.updatedAt > 30 * 60 * 1000) {
                    logger.info('Daily data is older than 30 minutes, triggering background update');
                    this.updateTeleporterData().catch(err => {
                        logger.error('Error in background teleporter update:', {
                            message: err.message
                        });
                    });
                }
                
                return anyData.messageCounts;
            }
            
            // If no data in database at all, trigger an update and return empty array for now
            // This should only happen on first run
            logger.warn('No teleporter data in database, triggering update');
            this.updateTeleporterData().catch(err => {
                logger.error('Error in background teleporter update:', {
                    message: err.message
                });
            });
            
            // Return empty array while update is in progress
            return [];
            
        } catch (error) {
            logger.error('Error processing teleporter messages:', {
                message: error.message,
                stack: error.stack
            });
            
            // In case of error, return empty array
            return [];
        }
    }

    /**
     * Processes teleporter messages to get weekly counts (last 7 days) grouped by source and destination chains
     * @returns {Promise<Array>} Array of objects with sourceChain, destinationChain, and messageCount
     */
    async getWeeklyCrossChainMessageCount() {
        try {
            logger.info('Fetching weekly cross-chain message count (last 7 days)...');
            
            // First check if we have recent weekly data in the database
            const recentWeeklyData = await this.getRecentMessageCountFromDB(168 * 60 * 1000, 'weekly'); // 7 days in ms
            
            // Check if an update is already in progress
            const updateState = await TeleporterUpdateState.findOne({ 
                updateType: 'weekly'
            });
            
            // If there's an update in progress that hasn't been updated in 5 minutes, mark it as stale
            if (updateState && updateState.state === 'in_progress') {
                const lastUpdated = new Date(updateState.lastUpdatedAt);
                const timeSinceUpdate = Date.now() - lastUpdated.getTime();
                
                if (timeSinceUpdate > 5 * 60 * 1000) { // 5 minutes
                    logger.warn('Found stale weekly update, marking as failed', {
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
            
            // If we have recent data and the update is completed or failed, use it
            if (recentWeeklyData) {
                logger.info('Using recent weekly teleporter message count data from database', {
                    updatedAt: recentWeeklyData.updatedAt,
                    totalMessages: recentWeeklyData.totalMessages,
                    timeWindow: recentWeeklyData.timeWindow
                });
                
                // If we have recent data and there's an update in progress, check if the data is newer than the update
                if (updateState && updateState.state === 'in_progress' && 
                    recentWeeklyData.updatedAt > updateState.startedAt) {
                    logger.info('Found update in progress but data is newer, marking update as completed', {
                        dataUpdatedAt: recentWeeklyData.updatedAt,
                        updateStartedAt: updateState.startedAt
                    });
                    
                    updateState.state = 'completed';
                    updateState.lastUpdatedAt = new Date();
                    updateState.progress = {
                        currentDay: 8,
                        totalDays: 7,
                        daysCompleted: 7,
                        messagesCollected: recentWeeklyData.totalMessages
                    };
                    await updateState.save();
                }
                
                return recentWeeklyData.messageCounts;
            }
            
            // If no recent data, try to get any weekly data from DB regardless of age
            logger.warn('No recent weekly teleporter data in database, checking for any weekly data');
            const anyWeeklyData = await this.getAnyMessageCountFromDB('weekly');
            
            if (anyWeeklyData) {
                logger.info('Using older weekly teleporter message count data from database', {
                    updatedAt: anyWeeklyData.updatedAt,
                    totalMessages: anyWeeklyData.totalMessages,
                    timeWindow: anyWeeklyData.timeWindow,
                    age: Math.round((Date.now() - anyWeeklyData.updatedAt) / (60 * 1000)) + ' minutes old'
                });
                
                // If there's no update in progress or the last update was more than 24 hours ago,
                // trigger a background update
                if (!updateState || updateState.state !== 'in_progress') {
                    if (Date.now() - anyWeeklyData.updatedAt > 24 * 60 * 60 * 1000) {
                        logger.info('Weekly data is older than 24 hours, but not triggering background update to avoid race conditions');
                        // Removed the automatic update trigger to avoid race conditions
                    }
                } else {
                    // If an update is in progress, log the status
                    logger.info('Weekly data update is already in progress', {
                        startedAt: updateState.startedAt,
                        progress: updateState.progress
                    });
                    
                    // If the data is newer than the update, mark the update as completed
                    if (anyWeeklyData.updatedAt > updateState.startedAt) {
                        logger.info('Found update in progress but data is newer, marking update as completed', {
                            dataUpdatedAt: anyWeeklyData.updatedAt,
                            updateStartedAt: updateState.startedAt
                        });
                        
                        updateState.state = 'completed';
                        updateState.lastUpdatedAt = new Date();
                        updateState.progress = {
                            currentDay: 8,
                            totalDays: 7,
                            daysCompleted: 7,
                            messagesCollected: anyWeeklyData.totalMessages
                        };
                        await updateState.save();
                    }
                }
                
                return anyWeeklyData.messageCounts;
            }
            
            // If no data in database at all, log a warning but don't start an update
            logger.warn('No weekly teleporter data in database');
            
            // Check if an update is already in progress
            if (updateState && updateState.state === 'in_progress') {
                logger.info('Weekly data update is already in progress', {
                    startedAt: updateState.startedAt,
                    progress: updateState.progress
                });
            } else {
                // Trigger an update if no data exists
                logger.info('No update in progress and no data available. Triggering initial data update.');
                
                // Create a new update state
                const newUpdateState = new TeleporterUpdateState({
                    updateType: 'weekly',
                    state: 'in_progress',
                    startedAt: new Date(),
                    lastUpdatedAt: new Date(),
                    progress: {
                        currentDay: 1,
                        totalDays: 7,
                        daysCompleted: 0,
                        messagesCollected: 0
                    }
                });
                
                await newUpdateState.save();
                
                // Trigger the update in the background
                this.updateWeeklyTeleporterData().catch(err => {
                    logger.error('Error during automatic weekly data update:', {
                        message: err.message,
                        stack: err.stack
                    });
                });
                
                logger.info('Weekly data update has been triggered in the background');
            }
            
            // Return empty array while update is in progress
            return [];
            
        } catch (error) {
            logger.error('Error processing weekly teleporter messages:', {
                message: error.message,
                stack: error.stack
            });
            
            // In case of error, return empty array
            return [];
        }
    }

    /**
     * Update weekly teleporter data in the database using an incremental approach
     * This method will update one day at a time and track progress in the database
     * @returns {Promise<Array>} Array of processed message counts or empty array if in progress
     */
    async updateWeeklyTeleporterData() {
        let updateState = null;
        try {
            logger.info('Starting weekly teleporter data update...');
            
            // Check if there's already an update in progress
            updateState = await TeleporterUpdateState.findOne({ 
                updateType: 'weekly'
            });
            
            // If there's an update in progress, check if it's stale
            if (updateState && updateState.state === 'in_progress') {
                const lastUpdated = new Date(updateState.lastUpdatedAt);
                const timeSinceUpdate = Date.now() - lastUpdated.getTime();
                
                if (timeSinceUpdate > 10 * 60 * 1000) { // 10 minutes
                    logger.warn('Found stale weekly update, resetting it', {
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
                    
                    // Create a new update state
                    updateState = null;
                } else {
                    logger.info('Weekly update already in progress, not starting a new one', {
                        startedAt: updateState.startedAt,
                        lastUpdatedAt: updateState.lastUpdatedAt,
                        progress: updateState.progress
                    });
                    return { status: 'in_progress', updateState };
                }
            }
            
            // If no update state or previous update was completed/failed, create a new one
            if (!updateState || updateState.state !== 'in_progress') {
                updateState = new TeleporterUpdateState({
                    updateType: 'weekly',
                    state: 'in_progress',
                    startedAt: new Date(),
                    lastUpdatedAt: new Date(),
                    progress: {
                        currentDay: 1,
                        totalDays: 7,
                        daysCompleted: 0,
                        messagesCollected: 0
                    }
                });
                
                await updateState.save();
                logger.info('Created new weekly update state', { id: updateState._id });
            }
            
            // Determine which day to process
            const currentDay = updateState.progress?.currentDay || 1;
            const daysCompleted = updateState.progress?.daysCompleted || 0;
            const partialResults = updateState.partialResults || [];
            let totalMessagesCollected = updateState.progress?.messagesCollected || 0;
            
            logger.info(`Processing day ${currentDay}/7 (${daysCompleted} days completed)`, {
                partialResultsCount: partialResults.length,
                totalMessagesCollected
            });
            
            // Calculate the time range for this day
            // For day 1, we fetch 0-24 hours ago
            // For day 2, we fetch 24-48 hours ago, etc.
            const endHoursAgo = (currentDay - 1) * 24;
            const startHoursAgo = endHoursAgo + 24;
            
            logger.info(`Fetching messages for day ${currentDay}: ${startHoursAgo}-${endHoursAgo} hours ago`);
            
            // We'll fetch each day in 12-hour chunks to avoid timeouts
            const HOURS_PER_CHUNK = 4; // Changed from 12 to 4 hours per chunk
            const CHUNKS_PER_DAY = 24 / HOURS_PER_CHUNK; // 6 chunks per day
            
            let dayMessages = [];
            let chunkErrors = [];
            
            for (let i = 0; i < CHUNKS_PER_DAY; i++) {
                try {
                    const chunkStartHours = endHoursAgo + (HOURS_PER_CHUNK * (CHUNKS_PER_DAY - i));
                    const chunkEndHours = chunkStartHours - HOURS_PER_CHUNK;
                    
                    logger.info(`Fetching chunk ${i+1}/${CHUNKS_PER_DAY} for day ${currentDay}: ${chunkStartHours}-${chunkEndHours} hours ago`);
                    
                    // Update the state to show which chunk we're processing
                    updateState.progress = {
                        currentDay,
                        totalDays: 7,
                        daysCompleted,
                        currentChunk: i + 1,
                        totalChunks: CHUNKS_PER_DAY,
                        messagesCollected: totalMessagesCollected
                    };
                    updateState.lastUpdatedAt = new Date();
                    await updateState.save();
                    
                    // Fetch messages for this time chunk
                    const result = await this.fetchTeleporterMessagesWithTimeRange(chunkStartHours, chunkEndHours);
                    
                    // Add messages from this chunk to our collection
                    dayMessages = [...dayMessages, ...result.messages];
                    
                    logger.info(`Completed chunk ${i+1}/${CHUNKS_PER_DAY} for day ${currentDay}, collected ${result.messages.length} messages`, {
                        hitPageLimit: result.hitPageLimit,
                        reachedTimeLimit: result.reachedTimeLimit,
                        dayMessages: dayMessages.length,
                        totalMessages: totalMessagesCollected + dayMessages.length
                    });
                    
                    // If we hit the page limit, log a warning
                    if (result.hitPageLimit) {
                        logger.warn(`Hit page limit in chunk ${i+1}/${CHUNKS_PER_DAY} for day ${currentDay}, some messages may be missing`);
                    }
                    
                    // Add a delay before fetching the next chunk to avoid rate limiting
                    if (i < CHUNKS_PER_DAY - 1) {
                        await this.sleep(8000);
                    }
                    
                } catch (error) {
                    // Log the error but continue with the next chunk
                    logger.error(`Error processing chunk ${i+1}/${CHUNKS_PER_DAY} for day ${currentDay}:`, {
                        message: error.message,
                        code: error.code,
                        status: error.response?.status
                    });
                    
                    chunkErrors.push({
                        day: currentDay,
                        chunk: i + 1,
                        error: error.message,
                        timestamp: new Date()
                    });
                    
                    // Add a longer delay after an error
                    await this.sleep(10000);
                }
            }
            
            // Process the collected messages for this day
            if (dayMessages.length > 0) {
                logger.info(`Processing ${dayMessages.length} teleporter messages for day ${currentDay}...`);
                
                // Process the messages to get counts by source and destination
                const processedDayData = await this.processMessages(dayMessages);
                
                // Add the processed data to the partial results
                const dayResult = {
                    day: currentDay,
                    messageCount: processedDayData,
                    totalMessages: dayMessages.length,
                    timeWindow: 24, // 24 hours
                    startHoursAgo,
                    endHoursAgo,
                    processedAt: new Date()
                };
                
                // Update the partial results
                partialResults.push(dayResult);
                totalMessagesCollected += dayMessages.length;
                
                // Update the state with the new partial results
                updateState.partialResults = partialResults;
                updateState.progress = {
                    currentDay: currentDay + 1, // Move to the next day
                    totalDays: 7,
                    daysCompleted: daysCompleted + 1,
                    messagesCollected: totalMessagesCollected
                };
                
                if (chunkErrors.length > 0) {
                    if (!updateState.error) {
                        updateState.error = {
                            message: `Errors in day ${currentDay}`,
                            details: []
                        };
                    }
                    
                    if (!updateState.error.details) {
                        updateState.error.details = [];
                    }
                    
                    updateState.error.details.push(...chunkErrors);
                    updateState.error.message = `Errors in ${updateState.error.details.length} chunks`;
                }
                
                updateState.lastUpdatedAt = new Date();
                await updateState.save();
                
                logger.info(`Completed day ${currentDay}/7 with ${dayMessages.length} messages, ${daysCompleted + 1} days completed`);
                
                // If we've completed all 7 days, finalize the weekly data
                if (currentDay >= 7) {
                    logger.info('All 7 days completed, finalizing weekly data...');
                    
                    // Combine all the partial results
                    let allMessages = [];
                    for (const dayResult of partialResults) {
                        allMessages = [...allMessages, ...dayResult.messageCount];
                    }
                    
                    // Aggregate the message counts by source and destination
                    const aggregatedCounts = {};
                    
                    for (const message of allMessages) {
                        const key = `${message.sourceChain}|${message.destinationChain}`;
                        
                        if (!aggregatedCounts[key]) {
                            aggregatedCounts[key] = {
                                sourceChain: message.sourceChain,
                                destinationChain: message.destinationChain,
                                messageCount: 0
                            };
                        }
                        
                        aggregatedCounts[key].messageCount += message.messageCount;
                    }
                    
                    // Convert to array and sort by message count
                    const finalMessageCount = Object.values(aggregatedCounts)
                        .sort((a, b) => b.messageCount - a.messageCount);
                    
                    // Save the processed data to the database
                    const teleporterData = new TeleporterMessage({
                        updatedAt: new Date(),
                        messageCounts: finalMessageCount,
                        totalMessages: totalMessagesCollected,
                        timeWindow: 168, // 7 days * 24 hours
                        dataType: 'weekly'
                    });
                    
                    await teleporterData.save();
                    
                    logger.info(`Saved weekly teleporter data with ${finalMessageCount.length} chain pairs and ${totalMessagesCollected} total messages`);
                    
                    // Update the state to completed
                    updateState.state = 'completed';
                    updateState.lastUpdatedAt = new Date();
                    updateState.progress = {
                        currentDay: 8,
                        totalDays: 7,
                        daysCompleted: 7,
                        messagesCollected: totalMessagesCollected
                    };
                    
                    // Clear the partial results to save space
                    updateState.partialResults = [];
                    
                    await updateState.save();
                    
                    // Double-check that the state is properly saved as completed
                    const finalState = await TeleporterUpdateState.findOne({ updateType: 'weekly' });
                    if (finalState && finalState.state !== 'completed') {
                        logger.warn('Update state was not properly saved as completed, fixing...', {
                            currentState: finalState.state
                        });
                        
                        finalState.state = 'completed';
                        finalState.lastUpdatedAt = new Date();
                        await finalState.save();
                    }
                    
                    return {
                        success: true,
                        messageCount: finalMessageCount.length,
                        totalMessages: totalMessagesCollected,
                        completed: true
                    };
                } else {
                    // We've completed this day but not all 7 days
                    return {
                        success: true,
                        day: currentDay,
                        daysCompleted: daysCompleted + 1,
                        messageCount: dayMessages.length,
                        totalMessages: totalMessagesCollected,
                        completed: false
                    };
                }
            } else {
                logger.warn(`No teleporter messages found for day ${currentDay} (${startHoursAgo}-${endHoursAgo} hours ago)`);
                
                // Even if no messages were found, mark this day as completed and move to the next
                updateState.progress = {
                    currentDay: currentDay + 1, // Move to the next day
                    totalDays: 7,
                    daysCompleted: daysCompleted + 1,
                    messagesCollected: totalMessagesCollected
                };
                
                if (chunkErrors.length > 0) {
                    if (!updateState.error) {
                        updateState.error = {
                            message: `Errors in day ${currentDay}`,
                            details: []
                        };
                    }
                    
                    if (!updateState.error.details) {
                        updateState.error.details = [];
                    }
                    
                    updateState.error.details.push(...chunkErrors);
                    updateState.error.message = `Errors in ${updateState.error.details.length} chunks`;
                }
                
                updateState.lastUpdatedAt = new Date();
                await updateState.save();
                
                // If we've completed all 7 days, finalize the weekly data
                if (currentDay >= 7) {
                    logger.info('All 7 days completed, finalizing weekly data...');
                    
                    // Combine all the partial results
                    let allMessages = [];
                    for (const dayResult of partialResults) {
                        allMessages = [...allMessages, ...dayResult.messageCount];
                    }
                    
                    // If we have no messages at all, return an error
                    if (allMessages.length === 0) {
                        logger.error('No teleporter messages found for the entire week');
                        
                        // Update the state to failed
                        updateState.state = 'failed';
                        updateState.lastUpdatedAt = new Date();
                        updateState.error = {
                            message: 'No messages found for the entire week',
                            details: chunkErrors.length > 0 ? chunkErrors : null
                        };
                        await updateState.save();
                        
                        return {
                            success: false,
                            error: 'No messages found for the entire week'
                        };
                    }
                    
                    // Aggregate the message counts by source and destination
                    const aggregatedCounts = {};
                    
                    for (const message of allMessages) {
                        const key = `${message.sourceChain}|${message.destinationChain}`;
                        
                        if (!aggregatedCounts[key]) {
                            aggregatedCounts[key] = {
                                sourceChain: message.sourceChain,
                                destinationChain: message.destinationChain,
                                messageCount: 0
                            };
                        }
                        
                        aggregatedCounts[key].messageCount += message.messageCount;
                    }
                    
                    // Convert to array and sort by message count
                    const finalMessageCount = Object.values(aggregatedCounts)
                        .sort((a, b) => b.messageCount - a.messageCount);
                    
                    // Save the processed data to the database
                    const teleporterData = new TeleporterMessage({
                        updatedAt: new Date(),
                        messageCounts: finalMessageCount,
                        totalMessages: totalMessagesCollected,
                        timeWindow: 168, // 7 days * 24 hours
                        dataType: 'weekly'
                    });
                    
                    await teleporterData.save();
                    
                    logger.info(`Saved weekly teleporter data with ${finalMessageCount.length} chain pairs and ${totalMessagesCollected} total messages`);
                    
                    // Update the state to completed
                    updateState.state = 'completed';
                    updateState.lastUpdatedAt = new Date();
                    updateState.progress = {
                        currentDay: 8,
                        totalDays: 7,
                        daysCompleted: 7,
                        messagesCollected: totalMessagesCollected
                    };
                    
                    // Clear the partial results to save space
                    updateState.partialResults = [];
                    
                    await updateState.save();
                    
                    // Double-check that the state is properly saved as completed
                    const finalState = await TeleporterUpdateState.findOne({ updateType: 'weekly' });
                    if (finalState && finalState.state !== 'completed') {
                        logger.warn('Update state was not properly saved as completed, fixing...', {
                            currentState: finalState.state
                        });
                        
                        finalState.state = 'completed';
                        finalState.lastUpdatedAt = new Date();
                        await finalState.save();
                    }
                    
                    return {
                        success: true,
                        messageCount: finalMessageCount.length,
                        totalMessages: totalMessagesCollected,
                        completed: true
                    };
                } else {
                    // We've completed this day but not all 7 days
                    return {
                        success: true,
                        day: currentDay,
                        daysCompleted: daysCompleted + 1,
                        messageCount: 0,
                        totalMessages: totalMessagesCollected,
                        completed: false
                    };
                }
            }
        } catch (error) {
            logger.error('Error updating weekly teleporter data:', {
                message: error.message,
                stack: error.stack
            });
            
            // Update the state to failed
            try {
                if (updateState) {
                    updateState.state = 'failed';
                    updateState.lastUpdatedAt = new Date();
                    updateState.error = {
                        message: error.message,
                        stack: error.stack
                    };
                    await updateState.save();
                    logger.info('Updated weekly update state to failed', { id: updateState._id });
                } else {
                    // Try to find the update state again
                    updateState = await TeleporterUpdateState.findOne({ updateType: 'weekly' });
                    if (updateState) {
                        updateState.state = 'failed';
                        updateState.lastUpdatedAt = new Date();
                        updateState.error = {
                            message: error.message,
                            stack: error.stack
                        };
                        await updateState.save();
                        logger.info('Updated weekly update state to failed', { id: updateState._id });
                    }
                }
            } catch (stateError) {
                logger.error('Error updating weekly update state:', {
                    message: stateError.message,
                    stack: stateError.stack
                });
            }
            
            throw error;
        }
    }

    /**
     * Get recent message count data from database (less than REFRESH_INTERVAL old)
     * @param {number} refreshInterval - Time interval in milliseconds to consider data as recent
     * @param {string} dataType - Type of data to retrieve ('daily' or 'weekly')
     * @returns {Promise<Object|null>} Message count data or null if not available
     */
    async getRecentMessageCountFromDB(refreshInterval = this.REFRESH_INTERVAL, dataType = 'daily') {
        try {
            const cutoffTime = new Date(Date.now() - refreshInterval);
            
            const data = await TeleporterMessage.findOne({
                updatedAt: { $gte: cutoffTime },
                dataType: dataType
            }).sort({ updatedAt: -1 });
            
            if (data) {
                // Remove _id field from each message count item
                data.messageCounts = data.messageCounts.map(item => {
                    const itemObj = item.toObject ? item.toObject() : item;
                    const { _id, ...dataWithoutId } = itemObj;
                    return dataWithoutId;
                });
            }
            
            return data;
        } catch (error) {
            logger.error('Error getting recent message count from database:', {
                message: error.message
            });
            return null;
        }
    }

    /**
     * Get any message count data from database (regardless of age)
     * @returns {Promise<Object|null>} Message count data or null if not available
     */
    async getAnyMessageCountFromDB(dataType = 'daily') {
        try {
            const data = await TeleporterMessage.findOne({
                dataType: dataType
            }).sort({ updatedAt: -1 });
            
            if (data) {
                // Remove _id field from each message count item
                data.messageCounts = data.messageCounts.map(item => {
                    const itemObj = item.toObject ? item.toObject() : item;
                    const { _id, ...dataWithoutId } = itemObj;
                    return dataWithoutId;
                });
            }
            
            return data;
        } catch (error) {
            logger.error('Error getting any message count from database:', {
                message: error.message
            });
            return null;
        }
    }

    /**
     * Save message count data to database
     * @param {Array} messageCounts - Array of message count objects
     * @param {number} totalMessages - Total number of messages processed
     * @param {number} timeWindow - Time window in hours
     * @returns {Promise<void>}
     */
    async saveMessageCountToDB(messageCounts, totalMessages, timeWindow = 24, dataType = 'daily') {
        try {
            const teleporterMessage = new TeleporterMessage({
                updatedAt: new Date(),
                messageCounts,
                totalMessages,
                timeWindow,
                dataType
            });
            
            await teleporterMessage.save();
            
            logger.info('Saved teleporter message count data to database', {
                count: messageCounts.length,
                totalMessages,
                timeWindow,
                dataType
            });
        } catch (error) {
            logger.error('Error saving message count to database:', {
                message: error.message
            });
        }
    }

    /**
     * Process teleporter messages into count by source and destination
     * @param {Array} messages - Array of teleporter messages
     * @returns {Promise<Array>} Processed message counts
     */
    async processMessages(messages) {
        // Fetch all chains from the database to map blockchain IDs to chain names
        const chains = await Chain.find().select('chainId chainName').lean();
        
        // Create a mapping of blockchain IDs to chain names
        const blockchainIdToName = {};
        chains.forEach(chain => {
            blockchainIdToName[chain.chainId] = chain.chainName;
        });
        
        // Process messages to count by source -> destination
        const messageCounts = {};
        
        for (const message of messages) {
            const sourceId = message.sourceBlockchainId;
            const destId = message.destinationBlockchainId;
            
            // Get chain names or use IDs if names not available
            const sourceName = blockchainIdToName[message.sourceEvmChainId] || 
                              (message.sourceEvmChainId ? `Chain-${message.sourceEvmChainId}` : sourceId.substring(0, 8));
            const destName = blockchainIdToName[message.destinationEvmChainId] || 
                            (message.destinationEvmChainId ? `Chain-${message.destinationEvmChainId}` : destId.substring(0, 8));
            
            const key = `${sourceName}|${destName}`;
            
            if (!messageCounts[key]) {
                messageCounts[key] = {
                    sourceChain: sourceName,
                    destinationChain: destName,
                    messageCount: 0
                };
            }
            
            messageCounts[key].messageCount++;
        }
        
        // Convert to array
        const result = Object.values(messageCounts);
        
        // Sort by message count (descending)
        result.sort((a, b) => b.messageCount - a.messageCount);
        
        // Ensure we return plain objects without MongoDB-specific fields
        return result.map(item => ({
            sourceChain: item.sourceChain,
            destinationChain: item.destinationChain,
            messageCount: item.messageCount
        }));
    }
}

module.exports = new TeleporterService();