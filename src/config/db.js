const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const dbURI = process.env.NODE_ENV === 'production' 
      ? process.env.PROD_MONGODB_URI 
      : process.env.DEV_MONGODB_URI;

    if (!dbURI) {
      throw new Error('MongoDB URI is not defined in environment variables');
    }

    console.log(`Attempting to connect to MongoDB (${process.env.NODE_ENV} environment)`);
    
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
    });

    mongoose.connection.on('connected', () => {
      console.log('MongoDB connected');
    });
    
    const conn = await mongoose.connect(dbURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
      heartbeatFrequencyMS: 1000 // Check connection every second
    });
    
    console.log(`MongoDB Connected: ${conn.connection.host} (${process.env.NODE_ENV} environment)`);
    
    // Test write permissions
    try {
      await mongoose.connection.db.command({ ping: 1 });
      console.log('MongoDB write permission test successful');
    } catch (error) {
      console.error('MongoDB write permission test failed:', error);
      throw error; // Rethrow to trigger connection failure
    }
    
  } catch (error) {
    console.error('MongoDB Connection Error:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    throw error; // Rethrow the error to be handled by the caller
  }
};

module.exports = connectDB;
