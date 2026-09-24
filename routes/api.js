import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import Phone from '../models/Phone.js';
import Order from '../models/Order.js';

const router = express.Router();

// --- Cloudinary configuration (server-side, signed uploads) ---
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET;

if (CLOUD_NAME) {
  cloudinary.config({
    cloud_name: CLOUD_NAME,
    // Signed uploads when key/secret are provided; otherwise falls back to
    // an unsigned upload preset (if configured).
    ...(API_KEY && API_SECRET ? { api_key: API_KEY, api_secret: API_SECRET } : {}),
  });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpe?g|png|webp|gif|avif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files (jpg, png, webp, gif, avif) are allowed'));
  },
});

const uploadToCloudinary = (buffer, mimetype, originalname) =>
  new Promise((resolve, reject) => {
    const dataUri = `data:${mimetype};base64,${buffer.toString('base64')}`;
    const options = { folder: 'phone-store' };
    if (!(API_KEY && API_SECRET)) {
      // Unsigned mode: requires an "Unsigned" upload preset in the dashboard
      if (!UPLOAD_PRESET) {
        return reject(new Error(
          'Cloudinary not configured. Add CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET (or CLOUDINARY_UPLOAD_PRESET) to backend/.env'
        ));
      }
      options.upload_preset = UPLOAD_PRESET;
    }
    cloudinary.uploader
      .upload(dataUri, options)
      .then((result) => resolve(result))
      .catch(reject);
  });

const requireAuth = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

router.get('/phones', async (req, res) => {
  try {
    const { search = '', page = 1, limit = 12 } = req.query;
    const query = { name: { $regex: search, $options: 'i' }, stock: { $gt: 0 } };

    // If MongoDB isn't connected, return a clear 503 with fallback data
    if (mongoose.connection.readyState !== 1) {
      console.error('MongoDB not connected; returning fallback phones');
      const fallback = [
        { _id: 'offline-1', name: 'Sample Phone A', price: 199, specs: 'Fallback specs', stock: 0 },
        { _id: 'offline-2', name: 'Sample Phone B', price: 299, specs: 'Fallback specs', stock: 0 }
      ];
      return res.status(503).json({ error: 'Database unavailable', data: fallback });
    }

    const phones = await Phone.find(query)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    res.json(phones);
  } catch (err) {
    console.error('Error fetching phones:', err);
    res.status(500).json({ error: 'Failed to fetch phones' });
  }
});

router.get('/orders/me', requireAuth, async (req, res) => {
  const orders = await Order.find({ user: req.user.id })
    .populate('items.phoneId', 'name price');
  res.json(orders);
});

// Upload a product image to Cloudinary (authenticated users only)
router.post('/upload', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided (field name must be "image")' });
    }
    if (!CLOUD_NAME) {
      return res.status(500).json({ error: 'Cloudinary not configured. Add CLOUDINARY_CLOUD_NAME to backend/.env' });
    }

    const result = await uploadToCloudinary(req.file.buffer, req.file.mimetype, req.file.originalname);
    res.json({ url: result.secure_url, publicId: result.public_id });
  } catch (err) {
    console.error('Cloudinary upload error:', err?.message || err);
    let msg = err?.message || 'Image upload failed';
    if (err?.http_code === 401 || /unknown api key|invalid api key|signature/i.test(msg)) {
      msg = 'Cloudinary rejected the credentials. Put your real API key and API secret from the Cloudinary console (Dashboard > Product Environment Credentials) into backend/.env as CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET, then restart the backend.';
    } else if (/not configured/i.test(msg)) {
      msg = 'Cloudinary not configured. Add CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to backend/.env, then restart the backend.';
    }
    res.status(500).json({ error: msg });
  }
});

router.post('/phones', requireAuth, async (req, res) => {
  try {
    const { name, price, specs, stock = 0, image } = req.body;
    const phone = new Phone({ name, price, specs, stock, image });
    await phone.save();
    res.status(201).json({ message: 'Phone created', phone });
  } catch (err) {
    console.error('Error creating phone:', err);
    res.status(500).json({ error: 'Failed to create phone' });
  }
});

router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const { items, totalAmount } = req.body;
    
    const order = new Order({
      user: req.user.id,
      items,
      totalAmount,
      status: 'Awaiting Payment Processing'
    });

    await order.save();
    res.status(201).json({ message: 'Order placed successfully', orderId: order._id });
  } catch (error) {
    res.status(500).json({ error: 'Checkout failed' });
  }
});

export default router;
