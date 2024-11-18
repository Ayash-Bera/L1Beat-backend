const mongoose = require('mongoose');

const chainSchema = new mongoose.Schema({
  chainId: {
    type: String,
    required: true,
    unique: true
  },
  subnetId: String,
  status: String,
  chainName: String,
  description: String,
  vmName: String,
  explorerUrl: String,
  rpcUrl: String,
  isTestnet: Boolean,
  networkToken: {
    name: String,
    symbol: String,
    decimals: Number,
    logoUri: String,
    description: String
  },
  chainLogoUri: String,
  validatorCount: Number,
  validators: [{
    txHash: String,
    nodeId: String,
    subnetId: String,
    amountStaked: String,
    startTimestamp: Number,
    endTimestamp: Number,
    stakePercentage: Number,
    validatorHealth: {
      reachabilityPercent: Number,
      benchedPChainRequestsPercent: Number,
      benchedXChainRequestsPercent: Number,
      benchedCChainRequestsPercent: Number
    },
    delegatorCount: Number,
    potentialRewards: {
      validationRewardAmount: String,
      delegationRewardAmount: String
    },
    uptimePerformance: Number,
    avalancheGoVersion: String,
    validationStatus: String
  }],
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Chain', chainSchema);
