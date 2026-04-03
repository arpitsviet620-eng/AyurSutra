require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const connectDB = require("./config/dbConfig");

/* ===================== ROUTES ===================== */
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const profileRoutes = require("./routes/profileRoutes");
const patientRoutes = require("./routes/patientRoutes");
const doctorRoutes = require("./routes/doctorRoutes");
const therapyRoutes = require("./routes/therapyRoutes");
const treatmentRoutes = require("./routes/treatmentRoutes");
const appointmentRoutes = require("./routes/appointmentRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const billingRoutes = require("./routes/billingRoutes");
const reportRoutes = require("./routes/reportRoutes");
const metaRoutes = require("./routes/doctorMetaRoutes");
const searchRoutes = require("./routes/searchRoutes");
const medicalZoneRoutes = require("./routes/medicalZoneRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const chatbotRoutes = require("./routes/chatbotRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const serviceRoutes = require("./routes/serviceRoutes");
const medicalRecordRoutes = require("./routes/medicalRecordRoutes");

const app = express();

/* ===================== DATABASE ===================== */
connectDB();

/* ===================== CORS ===================== */
const allowedOrigins = [
  "https://ayursutrahealthcare.vercel.app",  //Frontend
  "https://ayur-sutra25.vercel.app", //Backend
  "http://localhost:3000",
  "http://localhost:5173",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS not allowed"));
      }
    },
    credentials: true,
  })
);

/* ===================== MIDDLEWARES ===================== */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ===================== ROUTES ===================== */
app.get("/", (req, res) => {
  res.send("Backend running 🚀");
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/patients", patientRoutes);
app.use("/api/doctors", doctorRoutes);
app.use("/api/doctors", metaRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/therapiest", therapyRoutes);
app.use("/api/treatments", treatmentRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/medical-zone", medicalZoneRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/medical-records", medicalRecordRoutes);

/* ===================== ERROR HANDLER ===================== */
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(500).json({ message: err.message || "Server Error" });
});

/* ===================== SOCKET.IO ===================== */
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

global.io = io;

io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  const userId = socket.handshake.auth?.userId;
  if (userId) {
    socket.join(userId);
    console.log(`🔔 User ${userId} joined room`);
  }

  socket.on("disconnect", () => {
    console.log("🔴 Socket disconnected:", socket.id);
  });
});

/* ===================== START SERVER ===================== */
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

module.exports = app;
