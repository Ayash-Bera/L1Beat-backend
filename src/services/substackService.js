const axios = require('axios');
const xml2js = require('xml2js');
const config = require('../config/config');
const logger = require('../utils/logger');
const BlogPost = require('../models/blogPost');

class SubstackService {
    constructor() {
        this.RSS_URL = 'https://ayashbera.substack.com/feed';
        this.TIMEOUT = 30000; // 30 seconds
        this.UPDATE_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours in milliseconds

        logger.info('SubstackService initialized', {
            rssUrl: this.RSS_URL,
            updateInterval: '12 hours'
        });
    }

    /**
     * Fetch RSS feed from Substack
     * @param {string} requestId - Request ID for tracking
     * @returns {Promise<Object>} Parsed RSS data
     */
    async fetchRSSFeed(requestId = 'unknown') {
        try {
            logger.info(`[SUBSTACK RSS] Fetching RSS feed [${requestId}]`, {
                url: this.RSS_URL
            });

            const response = await axios.get(this.RSS_URL, {
                timeout: this.TIMEOUT,
                headers: {
                    'Accept': 'application/rss+xml, application/xml, text/xml',
                    'User-Agent': 'l1beat-blog-service'
                }
            });

            if (!response.data) {
                throw new Error('No data received from RSS feed');
            }

            logger.info(`[SUBSTACK RSS] Successfully fetched RSS data [${requestId}]`, {
                dataLength: response.data.length,
                contentType: response.headers['content-type']
            });

            // Parse XML to JSON
            const parser = new xml2js.Parser({
                explicitArray: false,
                ignoreAttrs: false
            });

            const parsedData = await parser.parseStringPromise(response.data);

            if (!parsedData.rss || !parsedData.rss.channel) {
                throw new Error('Invalid RSS feed structure');
            }

            const channel = parsedData.rss.channel;
            const items = Array.isArray(channel.item) ? channel.item : [channel.item];

            logger.info(`[SUBSTACK RSS] Parsed RSS feed [${requestId}]`, {
                channelTitle: channel.title,
                itemCount: items ? items.length : 0
            });

            return {
                channel: channel,
                items: items || []
            };

        } catch (error) {
            logger.error(`[SUBSTACK RSS] Error fetching RSS feed [${requestId}]:`, {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText
            });
            throw error;
        }
    }

    /**
     * Process RSS items into blog post format
     * @param {Array} items - RSS items
     * @param {string} requestId - Request ID for tracking
     * @returns {Array} Processed blog posts
     */
    processRSSItems(items, requestId = 'unknown') {
        try {
            logger.info(`[SUBSTACK PROCESS] Processing ${items.length} RSS items [${requestId}]`);

            const processedPosts = items.map((item, index) => {
                try {
                    // Extract basic information
                    const title = item.title || 'Untitled';
                    const link = item.link || item.guid;
                    const pubDate = new Date(item.pubDate);

                    // Generate slug from title
                    const slug = this.generateSlug(title);

                    // Extract content (prefer content:encoded over description)
                    let content = item['content:encoded'] || item.description || '';

                    // Clean and process content
                    content = this.cleanContent(content);

                    // Generate excerpt from content
                    const excerpt = this.generateExcerpt(content);

                    // Extract Substack ID from GUID or link
                    const substackId = this.extractSubstackId(item.guid || link);

                    // Extract categories/tags if available
                    const tags = this.extractTags(item.category);

                    logger.debug(`[SUBSTACK PROCESS] Processed item ${index + 1}: ${title} [${requestId}]`);

                    return {
                        title: title.trim(),
                        slug: slug,
                        content: content,
                        excerpt: excerpt,
                        publishedAt: pubDate,
                        author: 'Ayash Bera',
                        substackUrl: link,
                        substackId: substackId,
                        tags: tags,
                        syncStatus: 'pending'
                    };
                } catch (itemError) {
                    logger.error(`[SUBSTACK PROCESS] Error processing item ${index + 1} [${requestId}]:`, {
                        error: itemError.message,
                        item: {
                            title: item.title,
                            guid: item.guid,
                            link: item.link
                        }
                    });
                    return null; // Return null for failed items
                }
            }).filter(post => post !== null); // Remove null items

            logger.info(`[SUBSTACK PROCESS] Successfully processed ${processedPosts.length} posts [${requestId}]`);
            return processedPosts;

        } catch (error) {
            logger.error(`[SUBSTACK PROCESS] Error processing RSS items [${requestId}]:`, {
                message: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Sync articles with database
     * @param {string} requestId - Request ID for tracking
     * @returns {Promise<Object>} Sync result
     */
    async syncArticles(requestId = `sync-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`) {
        try {
            logger.info(`[SUBSTACK SYNC] Starting article sync [${requestId}]`);

            // Fetch RSS feed
            const rssData = await this.fetchRSSFeed(requestId);

            if (!rssData.items || rssData.items.length === 0) {
                logger.warn(`[SUBSTACK SYNC] No articles found in RSS feed [${requestId}]`);
                return { success: true, synced: 0, updated: 0, errors: 0 };
            }

            // Process RSS items
            const processedPosts = this.processRSSItems(rssData.items, requestId);

            let syncedCount = 0;
            let updatedCount = 0;
            let errorCount = 0;

            // Sync each post
            for (const postData of processedPosts) {
                try {
                    // Calculate reading time
                    const readingTime = this.calculateReadingTime(postData.content);
                    postData.readingTime = readingTime;
                    postData.lastSynced = new Date();
                    postData.syncStatus = 'synced';

                    // Update or create post
                    const result = await BlogPost.findOneAndUpdate(
                        { substackId: postData.substackId },
                        {
                            $set: postData
                        },
                        {
                            upsert: true,
                            new: true,
                            setDefaultsOnInsert: true
                        }
                    );

                    if (result.isNew || result.lastModified) {
                        updatedCount++;
                    }
                    syncedCount++;

                    logger.debug(`[SUBSTACK SYNC] Synced post: ${postData.title} [${requestId}]`);

                } catch (postError) {
                    errorCount++;
                    logger.error(`[SUBSTACK SYNC] Error syncing post [${requestId}]:`, {
                        title: postData.title,
                        error: postError.message
                    });
                }
            }

            logger.info(`[SUBSTACK SYNC] Sync completed [${requestId}]`, {
                totalPosts: processedPosts.length,
                synced: syncedCount,
                updated: updatedCount,
                errors: errorCount
            });

            return {
                success: true,
                totalPosts: processedPosts.length,
                synced: syncedCount,
                updated: updatedCount,
                errors: errorCount,
                requestId: requestId
            };

        } catch (error) {
            logger.error(`[SUBSTACK SYNC] Sync failed [${requestId}]:`, {
                message: error.message,
                stack: error.stack
            });

            return {
                success: false,
                error: error.message,
                requestId: requestId
            };
        }
    }

    /**
     * Get all blog posts with caching
     * @param {Object} options - Query options
     * @returns {Promise<Array>} Blog posts
     */
    async getBlogPosts(options = {}) {
        try {
            const { limit = 10, offset = 0, tag } = options;

            // Check cache first
            const cacheManager = require('../utils/cacheManager');
            const cacheKey = `blog_posts_${limit}_${offset}_${tag || 'all'}`;
            const cachedPosts = cacheManager.get(cacheKey);

            if (cachedPosts) {
                logger.debug('Returning cached blog posts');
                return cachedPosts;
            }

            let query = { syncStatus: 'synced' };
            if (tag) {
                query.tags = { $in: [tag] };
            }

            const posts = await BlogPost.find(query)
                .sort({ publishedAt: -1 })
                .limit(limit)
                .skip(offset)
                .select('-content') // Exclude full content for list view
                .lean();

            // Cache the results for 10 minutes
            cacheManager.set(cacheKey, posts, 10 * 60 * 1000);

            logger.info(`Retrieved ${posts.length} blog posts`, { limit, offset, tag });
            return posts;

        } catch (error) {
            logger.error('Error retrieving blog posts:', {
                message: error.message,
                options: options
            });
            throw error;
        }
    }

    /**
     * Get single blog post by slug
     * @param {string} slug - Post slug
     * @returns {Promise<Object>} Blog post
     */
    async getBlogPostBySlug(slug) {
        try {
            // Check cache first
            const cacheManager = require('../utils/cacheManager');
            const cacheKey = `blog_post_${slug}`;
            const cachedPost = cacheManager.get(cacheKey);

            if (cachedPost) {
                logger.debug(`Returning cached blog post: ${slug}`);
                return cachedPost;
            }

            const post = await BlogPost.findOne({
                slug: slug,
                syncStatus: 'synced'
            }).lean();

            if (!post) {
                throw new Error('Blog post not found');
            }

            // Cache the result for 5 minutes
            cacheManager.set(cacheKey, post, 5 * 60 * 1000);

            logger.info(`Retrieved blog post: ${slug}`);
            return post;

        } catch (error) {
            logger.error(`Error retrieving blog post by slug: ${slug}`, {
                message: error.message
            });
            throw error;
        }
    }

    // Helper methods
    generateSlug(title) {
        return title
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim('-')
            .substring(0, 100);
    }

    cleanContent(content) {
        // Remove any unwanted HTML or clean up content
        // You can add more cleaning logic here
        return content.trim();
    }

    generateExcerpt(content, maxLength = 200) {
        // Remove HTML tags
        const textContent = content.replace(/<[^>]*>/g, ' ');
        // Clean up whitespace
        const cleanText = textContent.replace(/\s+/g, ' ').trim();
        // Truncate to maxLength
        if (cleanText.length <= maxLength) return cleanText;
        return cleanText.substring(0, maxLength).replace(/\s+\w*$/, '') + '...';
    }

    extractSubstackId(guid) {
        // Extract ID from GUID or URL
        if (!guid) return Date.now().toString();

        // Handle different guid formats (string, object, etc.)
        let guidString = '';
        if (typeof guid === 'string') {
            guidString = guid;
        } else if (typeof guid === 'object') {
            // Some RSS feeds have guid as object with _ property or text content
            guidString = guid._ || guid.text || guid.value || JSON.stringify(guid);
        } else {
            guidString = String(guid);
        }

        // Try to extract ID from URL
        const match = guidString.match(/\/p\/([^\/]+)/);
        if (match) return match[1];

        // Try to extract from substack URL pattern
        const substackMatch = guidString.match(/([a-zA-Z0-9-]+)\.substack\.com/);
        if (substackMatch) return substackMatch[1];

        // Fallback: use the full GUID as ID (clean it up)
        return guidString.replace(/[^\w-]/g, '').substring(0, 50) || Date.now().toString();
    }

    extractTags(category) {
        if (!category) return [];
        if (Array.isArray(category)) return category;
        return [category];
    }

    calculateReadingTime(content) {
        if (!content) return 0;
        const textContent = content.replace(/<[^>]*>/g, ' ');
        const wordCount = textContent.trim().split(/\s+/).length;
        return Math.ceil(wordCount / 200); // 200 words per minute
    }
}

module.exports = new SubstackService();