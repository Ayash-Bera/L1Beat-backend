const express = require('express');
const router = express.Router();
const blogController = require('../controllers/blogController');
const { validate, validators } = require('../utils/validationMiddleware');

/**
 * @route   GET /api/blog/posts
 * @desc    Get all blog posts with pagination and optional tag filtering
 * @access  Public
 * @query   limit - Number of posts to return (default: 10, max: 100)
 * @query   offset - Number of posts to skip (default: 0)
 * @query   tag - Filter posts by tag (optional)
 */
router.get('/blog/posts',
    validate(validators.getBlogPosts),
    blogController.getAllPosts
);

/**
 * @route   GET /api/blog/posts/:slug
 * @desc    Get single blog post by slug
 * @access  Public
 * @param   slug - Post slug identifier
 */
router.get('/blog/posts/:slug',
    validate(validators.getBlogPostBySlug),
    blogController.getPostBySlug
);

/**
 * @route   POST /api/blog/sync
 * @desc    Manually trigger RSS sync with Substack
 * @access  Public (you might want to add auth later)
 */
router.post('/blog/sync',
    validate(validators.syncBlogPosts),
    blogController.syncPosts
);

/**
 * @route   GET /api/blog/health
 * @desc    Get blog service health status and statistics
 * @access  Public
 */
router.get('/blog/health',
    blogController.getBlogHealth
);

/**
 * @route   GET /api/blog/tags
 * @desc    Get all available tags with post counts
 * @access  Public
 */
router.get('/blog/tags',
    blogController.getTags
);

module.exports = router;