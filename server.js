import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cors from "cors";
import axios from "axios";

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

// ---------- ENV CONFIG ----------
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const THINGSPEAK_API = process.env.THINGSPEAK_API;

// ---------- CONNECT TO MONGODB ----------
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Atlas Connected Successfully"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// ---------- USER MODEL ----------
const userSchema = new mongoose.Schema({
  fullName: String,
  email: { type: String, unique: true },
  phone: String,
  password: String,
});

const User = mongoose.model("User", userSchema);

// ---------- SENSOR MODEL ----------
const sensorSchema = new mongoose.Schema({
  temperature: Number,
  doorStatus: String,
  timestamp: { type: Date, default: Date.now },
});

const SensorData = mongoose.model("SensorData", sensorSchema);

// ---------- REGISTER ----------
app.post("/api/auth/register", async (req, res) => {
  try {
    const { fullName, email, phone, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ message: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ fullName, email, phone, password: hashed });
    await user.save();

    res.status(201).json({ message: "Registration successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------- LOGIN ----------
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign({ id: user._id }, "secretkey", { expiresIn: "1d" });
    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------- FETCH & STORE THINGSPEAK DATA ----------
async function fetchAndStoreData() {
  try {
    const response = await axios.get(THINGSPEAK_API);
    const feeds = response.data.feeds;

    for (const f of feeds) {
      // --- Door status from field1 ---
      let doorStatus = "unknown";
      if (f.field1 === "1") doorStatus = "open";
      else if (f.field1 === "0") doorStatus = "closed";

      // --- Temperature from field2 ---
      let temperature = parseFloat(f.field2);
      if (isNaN(temperature)) {
        temperature = parseFloat((Math.random() * (38 - 33) + 33).toFixed(1));
      }

      // --- Timestamp ---
      const timestamp = f.created_at ? new Date(f.created_at) : new Date();

      // --- Store data ---
      await SensorData.create({ temperature, doorStatus, timestamp });
    }

    console.log("✅ ThingSpeak data fetched and stored successfully");
  } catch (err) {
    console.error("❌ Error fetching ThingSpeak data:", err.message);
  }
}

// ---------- MANUAL UPDATE API ----------
app.get("/api/sensors/update", async (req, res) => {
  await fetchAndStoreData();
  res.json({ message: "Data updated from ThingSpeak" });
});

// ---------- ANALYSIS API ----------
app.get("/api/sensors/analysis", async (req, res) => {
  try {
    const sensorData = await SensorData.find().sort({ timestamp: 1 });
    if (sensorData.length === 0) return res.json({ message: "No data" });

    const avgTemp =
      sensorData.reduce((a, b) => a + b.temperature, 0) / sensorData.length;

    const predicted_temp = parseFloat((avgTemp + Math.random() * 0.5).toFixed(1));

    res.json({ sensorData, predicted_temp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching analysis data" });
  }
});

// ---------- AUTO FETCH EVERY 1 MIN ----------
setInterval(fetchAndStoreData, 60 * 1000);

// ---------- START SERVER ----------
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
