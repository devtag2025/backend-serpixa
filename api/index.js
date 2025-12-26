import 'dotenv/config';
import app from '../src/app.js';
import connectDB from '../src/config/db.js';

// Vercel serverless handler
export default async function handler(req, res) {
  try {
    // Connect to database (uses cached connection)
    await connectDB();
    
    // Pass request to Express app
    return app(req, res);
  } catch (error) {
    console.error('Serverless function error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message 
    });
  }
}