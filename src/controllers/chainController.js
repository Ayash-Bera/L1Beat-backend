const chainService = require('../services/chainService');

exports.getAllChains = async (req, res) => {
    try {
        console.log('Fetching all chains...');
        const chains = await chainService.getAllChains();
        
        if (!chains || !Array.isArray(chains)) {
            console.warn('No valid chains data returned');
            return res.status(404).json({
                success: false,
                error: 'No chains found'
            });
        }
        
        // Cache the response for 1 minute
        res.set('Cache-Control', 'public, max-age=60');
        
        console.log('Chains fetched successfully:', {
            count: chains.length,
            timestamp: new Date().toISOString()
        });
        
        // Return just the array without wrapping
        res.json(chains);
    } catch (error) {
        console.error('Error in getAllChains:', {
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        res.status(500).json({
            success: false,
            error: 'Failed to fetch chains'
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
