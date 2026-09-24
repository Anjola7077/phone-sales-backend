import mongoose from 'mongoose';

const phoneSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  specs: { type: String, required: true },
  stock: { type: Number, default: 10 },
  image: { type: String },
});

export default mongoose.model('Phone', phoneSchema);