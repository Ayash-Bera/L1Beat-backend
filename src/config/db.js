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
    
    const conn = await mongoose.connect(dbURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log(`MongoDB Connected: ${conn.connection.host} (${process.env.NODE_ENV} environment)`);
    
    // Test write permissions
    try {
      await mongoose.connection.db.command({ ping: 1 });
      console.log('MongoDB write permission test successful');
    } catch (error) {
      console.error('MongoDB write permission test failed:', error);
    }
    
  } catch (error) {
    console.error(`MongoDB Connection Error: ${error.message}`);
    console.error('Full error:', error);
    process.exit(1);
  }
};

module.exports = connectDB;
