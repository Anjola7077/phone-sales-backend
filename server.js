import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';


dotenv.config();

const { default: authRoutes } = await import('./routes/auth.js');
const { default: apiRoutes } = await import('./routes/api.js');

const app = express();

// Warn at startup if ImageKit credentials are missing
const IMAGEKIT_PUBLIC_KEY = process.env.IMAGEKIT_PUBLIC_KEY;
const IMAGEKIT_PRIVATE_KEY = process.env.IMAGEKIT_PRIVATE_KEY;
const IMAGEKIT_URL_ENDPOINT = process.env.IMAGEKIT_URL_ENDPOINT;
if (!IMAGEKIT_PUBLIC_KEY || !IMAGEKIT_PRIVATE_KEY || !IMAGEKIT_URL_ENDPOINT) {
  console.warn(
    '\n⚠️  ImageKit upload is NOT configured!\n' +
    '   Add these values to backend/.env:\n' +
    '     IMAGEKIT_PUBLIC_KEY=<your public key>\n' +
    '     IMAGEKIT_PRIVATE_KEY=<your private key>\n' +
    '     IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/<your-id>\n' +
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
