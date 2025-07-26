const substackService = require('../services/substackService');
const logger = require('../utils/logger');
const BlogPost = require('../models/blogPost');

/**
 * Get all blog posts with pagination
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAllPosts = async (req, res) => {
    try {
        // Generate request ID for tracking
        const requestId = `posts-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        logger.info(`[BLOG CONTROLLER] Get all posts request started [${requestId}]`);

        // Extract query parameters with defaults
        const limit = parseInt(req.query.limit) || 10;
        const offset = parseInt(req.query.offset) || 0;
        const tag = req.query.tag;

        // Validate limit and offset
        if (limit > 100) {
            return res.status(400).json({
                success: false,
                error: 'Limit cannot exceed 100',
                message: 'Please use pagination for larger result sets'
            });
        }

        if (offset < 0) {
            return res.status(400).json({
                success: false,
                error: 'Offset cannot be negative',
                message: 'Offset must be 0 or greater'
            });
        }

        // Get posts from service
        const posts = await substackService.getBlogPosts({ limit, offset, tag });

        // Get total count for pagination metadata
        let totalQuery = { syncStatus: 'synced' };
        if (tag) {
            totalQuery.tags = { $in: [tag] };
        }
        const totalCount = await BlogPost.countDocuments(totalQuery);

        logger.info(`[BLOG CONTROLLER] Retrieved ${posts.length} posts [${requestId}]`, {
            limit,
            offset,
            tag: tag || null,
            totalCount
        });

        // Response with pagination metadata
        const response = {
            success: true,
            data: posts,
            metadata: {
                total: totalCount,
                limit: limit,
                offset: offset,
                hasMore: offset + limit < totalCount,
                tag: tag || null,
                requestId: requestId
            }
        };

        res.json(response);

    } catch (error) {
        logger.error('[BLOG CONTROLLER] Error in getAllPosts:', {
            message: error.message,
            stack: error.stack,
            query: req.query
        });

        res.status(500).json({
            success: false,
            error: 'Failed to fetch blog posts',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

/**
 * Get single blog post by slug
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getPostBySlug = async (req, res) => {
    try {
        const { slug } = req.params;

        // Generate request ID for tracking
        const requestId = `post-${slug}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        logger.info(`[BLOG CONTROLLER] Get post by slug request: ${slug} [${requestId}]`);

        if (!slug) {
            return res.status(400).json({
                success: false,
                error: 'Slug is required',
                message: 'Please provide a valid post slug'
            });
        }

        // Get post from service
        const post = await substackService.getBlogPostBySlug(slug);

        if (!post) {
            logger.warn(`[BLOG CONTROLLER] Post not found: ${slug} [${requestId}]`);
            return res.status(404).json({
                success: false,
                error: 'Post not found',
                message: `No post found with slug: ${slug}`
            });
        }

        // Optional: Increment view count
        await BlogPost.findByIdAndUpdate(
            post._id,
            { $inc: { views: 1 } },
            { new: false }
        ).catch(err => {
            // Don't fail the request if view increment fails
            logger.warn(`[BLOG CONTROLLER] Failed to increment view count for ${slug}:`, err.message);
        });

        logger.info(`[BLOG CONTROLLER] Retrieved post: ${slug} [${requestId}]`, {
            title: post.title,
            publishedAt: post.publishedAt
        });

        const response = {
            success: true,
            data: post,
            metadata: {
                requestId: requestId,
                retrievedAt: new Date().toISOString()
            }
        };

        res.json(response);

    } catch (error) {
        logger.error(`[BLOG CONTROLLER] Error in getPostBySlug for ${req.params.slug}:`, {
            message: error.message,
            stack: error.stack
        });

        if (error.message === 'Blog post not found') {
            res.status(404).json({
                success: false,
                error: 'Post not found',
                message: `No post found with slug: ${req.params.slug}`
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to fetch blog post',
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    }
};

/**
 * Manually trigger RSS sync
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.syncPosts = async (req, res) => {
    try {
        // Generate request ID for tracking
        const requestId = `manual-sync-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        logger.info(`[BLOG CONTROLLER] Manual sync triggered [${requestId}]`);

        // Check if sync is already in progress (optional rate limiting)
        const recentSync = await BlogPost.findOne({})
            .sort({ lastSynced: -1 })
            .select('lastSynced')
            .lean();

        if (recentSync && recentSync.lastSynced) {
            const timeSinceLastSync = Date.now() - new Date(recentSync.lastSynced).getTime();
            const minimumInterval = 5 * 60 * 1000; // 5 minutes

            if (timeSinceLastSync < minimumInterval) {
                logger.warn(`[BLOG CONTROLLER] Sync rate limited [${requestId}]`, {
                    timeSinceLastSync: Math.round(timeSinceLastSync / 1000),
                    minimumInterval: minimumInterval / 1000
                });

                return res.status(429).json({
                    success: false,
                    error: 'Sync rate limited',
                    message: `Please wait ${Math.round((minimumInterval - timeSinceLastSync) / 1000)} seconds before syncing again`,
                    nextSyncAvailable: new Date(new Date(recentSync.lastSynced).getTime() + minimumInterval).toISOString()
                });
            }
        }

        // Trigger sync
        const result = await substackService.syncArticles(requestId);

        logger.info(`[BLOG CONTROLLER] Manual sync completed [${requestId}]`, result);

        const response = {
            success: result.success,
            data: {
                totalPosts: result.totalPosts,
                synced: result.synced,
                updated: result.updated,
                errors: result.errors
            },
            metadata: {
                requestId: result.requestId,
                syncedAt: new Date().toISOString()
            }
        };

        if (!result.success) {
            response.error = result.error;
        }

        res.json(response);

    } catch (error) {
        logger.error('[BLOG CONTROLLER] Error in syncPosts:', {
            message: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            error: 'Failed to sync blog posts',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

/**
 * Get blog statistics and health check
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getBlogHealth = async (req, res) => {
    try {
        logger.info('[BLOG CONTROLLER] Blog health check requested');

        const currentTime = new Date();
        const oneDayAgo = new Date(currentTime.getTime() - (24 * 60 * 60 * 1000));

        // Get various statistics
        const [
            totalPosts,
            syncedPosts,
            recentPosts,
            failedPosts,
            mostRecentPost,
            totalViews
        ] = await Promise.all([
            BlogPost.countDocuments(),
            BlogPost.countDocuments({ syncStatus: 'synced' }),
            BlogPost.countDocuments({
                publishedAt: { $gte: oneDayAgo },
                syncStatus: 'synced'
            }),
            BlogPost.countDocuments({ syncStatus: 'failed' }),
            BlogPost.findOne({ syncStatus: 'synced' })
                .sort({ publishedAt: -1 })
                .select('title publishedAt lastSynced')
                .lean(),
            BlogPost.aggregate([
                { $group: { _id: null, totalViews: { $sum: '$views' } } }
            ])
        ]);

        const stats = {
            totalPosts,
            syncedPosts,
            recentPosts,
            failedPosts,
            totalViews: totalViews[0]?.totalViews || 0,
            mostRecentPost: mostRecentPost ? {
                title: mostRecentPost.title,
                publishedAt: mostRecentPost.publishedAt,
                lastSynced: mostRecentPost.lastSynced
            } : null,
            healthStatus: syncedPosts > 0 ? 'healthy' : 'no_data',
            lastChecked: currentTime.toISOString()
        };

        logger.info('[BLOG CONTROLLER] Blog health check completed', {
            totalPosts: stats.totalPosts,
            syncedPosts: stats.syncedPosts,
            healthStatus: stats.healthStatus
        });

        res.json({
            success: true,
            data: stats,
            metadata: {
                environment: process.env.NODE_ENV || 'development',
                checkedAt: currentTime.toISOString()
            }
        });

    } catch (error) {
        logger.error('[BLOG CONTROLLER] Error in getBlogHealth:', {
            message: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            error: 'Failed to get blog health status',
            message: error.message
        });
    }
};

/**
 * Get available tags
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getTags = async (req, res) => {
    try {
        logger.info('[BLOG CONTROLLER] Get tags request');

        // Get all unique tags with post counts
        const tags = await BlogPost.aggregate([
            { $match: { syncStatus: 'synced' } },
            { $unwind: '$tags' },
            {
                $group: {
                    _id: '$tags',
                    count: { $sum: 1 }
                }
            },
            {
                $project: {
                    _id: 0,
                    tag: '$_id',
                    count: 1
                }
            },
            { $sort: { count: -1 } }
        ]);

        logger.info(`[BLOG CONTROLLER] Retrieved ${tags.length} tags`);

        res.json({
            success: true,
            data: tags,
            metadata: {
                totalTags: tags.length,
                retrievedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        logger.error('[BLOG CONTROLLER] Error in getTags:', {
            message: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            error: 'Failed to fetch tags',
            message: error.message
        });
    }
};