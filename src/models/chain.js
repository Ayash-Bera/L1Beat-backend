const mongoose = require('mongoose');

const chainSchema = new mongoose.Schema({
    chainId: { type: String, required: true, unique: true },
    status: String,
    chainName: String,
    description: String,
    platformChainId: String,
    subnetId: String,
    vmId: String,
    vmName: String,
    explorerUrl: String,
    rpcUrl: String,
    wsUrl: String,
    isTestnet: Boolean,
    utilityAddresses: {
        multicall: String
    },
    networkToken: {
        name: String,
        symbol: String,
        decimals: Number,
        logoUri: String,
        description: String
    },
    chainLogoUri: String,
    private: Boolean,
    enabledFeatures: [String],
    validators: [{
        nodeId: String,
        txHash: String,
        amountStaked: String,
        startTimestamp: Number,
        endTimestamp: Number,
        validationStatus: String,
        uptimePerformance: Number,
        avalancheGoVersion: String
    }],
    lastUpdated: { type: Date, default: Date.now },
    tps: {
        value: Number,
        timestamp: Number,
        lastUpdated: Date
    }
});

module.exports = mongoose.model('Chain', chainSchema);
