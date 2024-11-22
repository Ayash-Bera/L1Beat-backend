const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const dbURI = process.env.NODE_ENV === 'production' 
      ? process.env.PROD_MONGODB_URI 
      : process.env.DEV_MONGODB_URI;

    if (!dbURI) {
      throw new Error('MongoDB URI is not defined in environment variables');
    }

    const conn = await mongoose.connect(dbURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log(`MongoDB Connected: ${conn.connection.host} (${process.env.NODE_ENV} environment)`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
