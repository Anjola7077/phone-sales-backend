import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';



dotenv.config();

const app = express();

// Warn loudly at startup if Cloudinary credentials are missing or still placeholders
const CLD_KEY = process.env.CLOUDINARY_API_KEY;
const CLD_SECRET = process.env.CLOUDINARY_API_SECRET;
if (!CLD_KEY || !CLD_SECRET || CLD_KEY === 'your_api_key_here' || CLD_SECRET === 'your_api_secret_here') {
  console.warn(
    '\n⚠️  Cloudinary upload is NOT configured!\n' +
    '   Put your real credentials in backend/.env:\n' +
    '     CLOUDINARY_API_KEY=<from Cloudinary console>\n' +
    '     CLOUDINARY_API_SECRET=<from Cloudinary console>\n' +
    '   Console: https://console.cloudinary.com → Dashboard → Product Environment Credentials\n' +
    '   Then restart the backend. Image uploads will fail until then.\n'
  );
}

console.log('Backend: starting server bootstrap...');

app.use(helmet()); 
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true, 
}));
app.use(express.json({ limit: '10kb' })); 
app.use(cookieParser());
// note: express-mongo-sanitize removed to avoid reassigning read-only req.query
app.use('/api', apiRoutes);

console.log('Backend: middleware registered');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  message: 'Too many requests, please try again later.'
});
app.use('/api', limiter);


app.use('/api/auth', authRoutes);

// Connect to MongoDB, then start the server. Exit on failure.
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

console.log('Backend: mongoose.connect initiated');

// Global error handlers for better visibility during development
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
