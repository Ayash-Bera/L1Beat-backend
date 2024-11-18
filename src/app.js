require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const connectDB = require('./config/db');
const chainRoutes = require('./routes/chainRoutes');
const fetchAndUpdateChains = require('./utils/fetchGlacierData');

const app = express();

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', chainRoutes);

// Schedule data fetch every hour
cron.schedule('0 * * * *', () => {
  console.log('Running scheduled fetch of chain data');
  fetchAndUpdateChains();
});

// Initial fetch
fetchAndUpdateChains();

const port = process.env.PORT || 5001;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
