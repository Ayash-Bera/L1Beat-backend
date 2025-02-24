const mongoose = require('mongoose');

const tvlSchema = new mongoose.Schema({
  date: {
    type: Number,
    required: true,
    unique: true
  },
  tvl: {
    type: Number,
    required: true
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

// Add index for better query performance
tvlSchema.index({ date: -1 });

module.exports = mongoose.model('TVL', tvlSchema); 