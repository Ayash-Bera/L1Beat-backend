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

module.exports = mongoose.model('TVL', tvlSchema); 