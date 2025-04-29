# L1Beat Backend

A Node.js backend service for the L1Beat, providing API endpoints for Avalanche L1 data and metrics.

## Features

- **Chain Data**: Fetch and store information about Avalanche chains
- **Validator Data**: Track validators for each chain
- **TVL Tracking**: Historical and current TVL data for Avalanche
- **TPS Metrics**: Track transactions per second for each chain and the entire network
- **Caching**: In-memory caching for improved performance
- **Structured Logging**: Comprehensive logging system
- **Security**: Rate limiting, input validation, and security headers

## Tech Stack

- **Node.js** and **Express**: Backend framework
- **MongoDB**: Database for storing chain, validator, TVL, and TPS data
- **Mongoose**: MongoDB object modeling
- **Winston**: Structured logging
- **Helmet**: Security headers
- **Express Validator**: Input validation
- **Express Rate Limit**: API rate limiting
- **Node-cron**: Scheduled tasks

## API Endpoints

### Chain Endpoints

- `GET /api/chains`: Get all chains
- `GET /api/chains/:chainId`: Get a specific chain by ID
- `GET /api/chains/:chainId/validators`: Get validators for a specific chain

### TVL Endpoints

- `GET /api/tvl/history`: Get historical TVL data
- `GET /api/tvl/health`: Check TVL data health

### TPS Endpoints

- `GET /api/chains/:chainId/tps/history`: Get TPS history for a specific chain
- `GET /api/chains/:chainId/tps/latest`: Get latest TPS for a specific chain
- `GET /api/tps/network/latest`: Get latest network-wide TPS
- `GET /api/tps/network/history`: Get historical network-wide TPS
- `GET /api/tps/health`: Check TPS data health
- `GET /api/tps/diagnostic`: Get diagnostic information about TPS data
- `GET /api/tps/status`: Get TPS status summary

## Setup

### Prerequisites

- Node.js (v16.20.1 or higher)
- MongoDB

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/L1Beat/L1Beat-backend.git
   cd l1beat-backend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with the following variables:
   ```
   # Development Database
   DEV_MONGODB_URI=mongodb://localhost:27017/glacier-chains
   PROD_MONGODB_URI=mongodb+srv://[username]:[password]@your-mongodb-cluster/glacier-chains

   NODE_ENV=development
   PORT=5001

   ADMIN_API_KEY=your-admin-key
   UPDATE_API_KEY=your-update-key

   # Frontend URLs
   FRONTEND_URL=http://localhost:5173
   ```

4. Start the development server:
   ```
   npm run dev
   ```

### Production Deployment

For production deployment, set `NODE_ENV=production` and ensure all environment variables are properly configured.

#### Deploying to Vercel

This application is configured for deployment on Vercel. To deploy:

1. Install the Vercel CLI:
   ```
   npm install -g vercel
   ```

2. Create a `.env.production` file with your production environment variables:
   ```
   NODE_ENV=production
   PROD_MONGODB_URI=your_production_mongodb_uri
   ADMIN_API_KEY=your_production_admin_key
   UPDATE_API_KEY=your_production_update_key
   ```

3. Run the deployment script:
   ```
   ./deploy.sh
   ```

Alternatively, you can deploy directly from the Vercel dashboard by connecting your GitHub repository.

## Scheduled Tasks

The application runs several scheduled tasks:

- TVL updates: Every 30 minutes
- Chain and TPS updates: Every hour
- TPS verification: Every 15 minutes

## Caching

The application implements in-memory caching for frequently accessed data:

- Chain data: 5 minutes
- TVL history: 15 minutes
- TPS data: 5 minutes

## Security

The application implements several security measures:

- Rate limiting for API endpoints
- Input validation for all parameters
- Security headers via Helmet
- CORS configuration

## License

ISC 