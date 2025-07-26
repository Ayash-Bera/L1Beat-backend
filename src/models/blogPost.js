const mongoose = require('mongoose');

const blogPostSchema = new mongoose.Schema({
    // Basic post information
    title: {
        type: String,
        required: true,
        trim: true
    },
    slug: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    content: {
        type: String,
        required: true
    },
    excerpt: {
        type: String,
        trim: true
    },

    // Publication details
    publishedAt: {
        type: Date,
        required: true
    },
    author: {
        type: String,
        default: 'Ayash Bera'
    },

    // Substack specific data
    substackUrl: {
        type: String,
        required: true,
        unique: true
    },
    substackId: {
        type: String,
        required: true,
        unique: true
    },

    // Content metadata
    readingTime: {
        type: Number, // in minutes
        default: 0
    },
    tags: [{
        type: String,
        trim: true
    }],
    categories: [{
        type: String,
        trim: true
    }],

    // Sync and caching information
    lastSynced: {
        type: Date,
        default: Date.now
    },
    syncStatus: {
        type: String,
        enum: ['pending', 'synced', 'failed'],
        default: 'pending'
    },

    // Engagement metrics (if we want to track)
    views: {
        type: Number,
        default: 0
    },

    // System timestamps
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Indexes for efficient queries (following your existing patterns)
blogPostSchema.index({ publishedAt: -1 }); // Most recent first
blogPostSchema.index({ slug: 1 }); // For individual post lookup
blogPostSchema.index({ substackId: 1 }); // For sync operations
blogPostSchema.index({ syncStatus: 1 }); // For sync monitoring
blogPostSchema.index({ tags: 1 }); // For tag-based queries
blogPostSchema.index({ categories: 1 }); // For category-based queries
blogPostSchema.index({ lastSynced: -1 }); // For sync monitoring

// Compound indexes
blogPostSchema.index({ publishedAt: -1, syncStatus: 1 }); // Published posts that are synced
blogPostSchema.index({ author: 1, publishedAt: -1 }); // Posts by author, recent first

// Pre-save middleware to update the updatedAt timestamp
blogPostSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

// Instance method to calculate reading time (roughly 200 words per minute)
blogPostSchema.methods.calculateReadingTime = function () {
    if (!this.content) return 0;

    // Remove HTML tags for word count
    const textContent = this.content.replace(/<[^>]*>/g, ' ');
    const wordCount = textContent.trim().split(/\s+/).length;
    const readingTime = Math.ceil(wordCount / 200);

    return readingTime;
};

// Static method to find recent posts (following your service patterns)
blogPostSchema.statics.findRecentPosts = function (limit = 10) {
    return this.find({ syncStatus: 'synced' })
        .sort({ publishedAt: -1 })
        .limit(limit)
        .lean();
};

// Static method to find posts by tag
blogPostSchema.statics.findByTag = function (tag, limit = 10) {
    return this.find({
        tags: { $in: [tag] },
        syncStatus: 'synced'
    })
        .sort({ publishedAt: -1 })
        .limit(limit)
        .lean();
};

module.exports = mongoose.model('BlogPost', blogPostSchema);