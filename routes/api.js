import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import multer from 'multer';
import ImageKit from '@imagekit/nodejs';
import Phone from '../models/Phone.js';
import Order from '../models/Order.js';

dotenv.config();

const router = express.Router();

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpe?g|png|webp|gif|avif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files (jpg, png, webp, gif, avif) are allowed'));
  },
});

const uploadToImageKit = async (buffer, originalname) => {
  const requiredKeys = ['IMAGEKIT_PUBLIC_KEY', 'IMAGEKIT_PRIVATE_KEY', 'IMAGEKIT_URL_ENDPOINT'];
  const missing = requiredKeys.filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(`ImageKit not configured. Add ${missing.join(', ')} to backend/.env`);
  }

  return imagekit.upload({
    file: buffer.toString('base64'),
    fileName: originalname || `phone-${Date.now()}`,
    folder: 'phone-store',
    useUniqueFileName: true,
    tags: ['phone-store'],
    isPrivateFile: false,
  });
};

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

// Upload a product image to ImageKit (authenticated users only)
router.post('/upload', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided (field name must be "image")' });
    }

    const result = await uploadToImageKit(req.file.buffer, req.file.originalname);
    res.json({ url: result.url, publicId: result.fileId || result.publicId || result.name });
  } catch (err) {
    console.error('ImageKit upload error:', err?.message || err);
    let msg = err?.message || 'Image upload failed';
    if (/not configured/i.test(msg)) {
      msg = 'ImageKit not configured. Add IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, and IMAGEKIT_URL_ENDPOINT to backend/.env, then restart the backend.';
    } else if (/invalid|unauthorized|authentication|signature|private key|public key/i.test(msg)) {
      msg = 'ImageKit rejected the credentials. Check IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, and IMAGEKIT_URL_ENDPOINT in backend/.env, then restart the backend.';
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
