const chainService = require('../services/chainService');

exports.getAllChains = async (req, res) => {
    try {
        console.log('Fetching all chains...');
        const chains = await chainService.getAllChains();
        
        console.log('Chains fetched:', {
            count: chains?.length || 0,
            firstChain: chains?.[0] ? chains[0].chainId : null
        });
        
        res.json(chains || []);
    } catch (error) {
        console.error('Error in getAllChains:', error);
        res.status(500).json({ 
            error: 'Failed to fetch chains',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

exports.getChainById = async (req, res) => {
    try {
        const chain = await chainService.getChainById(req.params.chainId);
        res.json(chain);
    } catch (error) {
        if (error.message === 'Chain not found') {
            res.status(404).json({ error: error.message });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
};

exports.getChainValidators = async (req, res) => {
    try {
        const chain = await chainService.getChainById(req.params.chainId);
        res.json(chain.validators || []);
    } catch (error) {
        if (error.message === 'Chain not found') {
            res.status(404).json({ error: error.message });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
};
