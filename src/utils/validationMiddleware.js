const { param, query, validationResult } = require('express-validator');

// Middleware to validate and sanitize request parameters
const validate = (validations) => {
  return async (req, res, next) => {
    // Execute all validations
    await Promise.all(validations.map(validation => validation.run(req)));

    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
        message: 'Validation failed'
      });
    }

    next();
  };
};

// Common validation rules
const validationRules = {
  // Chain ID validation
  chainId: param('chainId')
    .trim()
    .notEmpty()
    .withMessage('Chain ID is required')
    .isString()
    .withMessage('Chain ID must be a string'),

  // Days parameter validation (for history endpoints)
  days: query('days')
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage('Days must be an integer between 1 and 365')
    .toInt()
};

// Validation chains for different routes
const validators = {
  // Chain routes
  getChainById: [
    validationRules.chainId
  ],
  
  getChainValidators: [
    validationRules.chainId
  ],
  
  // TPS routes
  getTpsHistory: [
    validationRules.chainId,
    validationRules.days
  ],
  
  getLatestTps: [
    validationRules.chainId
  ],
  
  // Teleporter routes
  getDailyCrossChainMessageCount: [],
  
  // Weekly teleporter routes
  getWeeklyCrossChainMessageCount: [],
  
  // Historical daily teleporter routes
  getHistoricalDailyData: [
    query('days')
      .optional()
      .isInt({ min: 1, max: 90 })
      .withMessage('Days must be an integer between 1 and 90')
      .toInt()
  ],
  
  // Generic chainId parameter validator
  getChainIdParam: [
    validationRules.chainId
  ]
};

module.exports = {
  validate,
  validators
}; 