const express = require("express")
const mongoose = require("mongoose")
const cors = require("cors")
const path = require("path")
const http = require("http")
const socketIo = require("socket.io")
const helmet = require("helmet")
const compression = require("compression")
require("dotenv").config()
const { setupSwagger } = require("./swagger")

// Import custom middleware
const { requestLogger, errorLogger } = require("./middleware/logger")
const { requestTimer, getMetrics } = require("./middleware/requestTimer")
const { sanitizeRequest, blockInjection } = require("./middleware/sanitizer")
const { normalizeRequest, trimStrings } = require("./middleware/inputNormalizer")
const { responseFormatter, addResponseHeaders } = require("./middleware/responseFormatter")
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler")
const { trackActivity } = require("./middleware/sessionManager")
const { cacheResponse, getCacheStats } = require("./middleware/cache")
const { connectRedis } = require("./utils/redisClient")

// Initialize Redis (non-blocking, falls back to in-memory if unavailable)
connectRedis()

// Import routes
const indexRoutes = require("./routes/index")
const authRoutes = require("./routes/auth")
const serviceRoutes = require("./routes/services")
const supplyRoutes = require("./routes/supplies")
const bookingRoutes = require("./routes/bookings")
const orderRoutes = require("./routes/orders")
const dashboardRoutes = require("./routes/dashboard-new")
const adminRoutes = require("./routes/admin")
const searchRoutes = require("./routes/search")
const reviewRoutes = require("./routes/reviews")
const notificationRoutes = require("./routes/notifications")
const deliveryRoutes = require("./routes/delivery")
const paymentRoutes = require("./routes/payment")
const workerRoutes = require("./routes/workers")
const verifierRoutes = require("./routes/verifier")

const socketHelper = require("./socket")

const app = express()
const server = http.createServer(app)
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
})

// Initialize socket helper
socketHelper.init(io)

// Make io available to our routes
app.io = io

// CORS configuration for React frontend
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
)

// Connect to MongoDB - use environment variable if available
if (mongoose.connection.readyState === 0) {
  const mongoURI = process.env.MONGODB_URI || "mongodb://localhost:27017/skilllink"
  mongoose
    .connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    .then(() => {
      console.log("Connected to MongoDB successfully")
      console.log("Database:", mongoose.connection.db.databaseName)
    })
    .catch((err) => {
      console.error("Could not connect to MongoDB:", err)
    })
}

// Handle MongoDB connection errors after initial connection
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err)
})

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected. Attempting to reconnect...')
})

mongoose.connection.on('connected', () => {
  console.log('MongoDB reconnected')
})

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for Socket.IO
  crossOriginEmbedderPolicy: false
}))
app.use(compression()) // Compress responses

// Custom Middleware - Request Processing Pipeline
app.use(requestLogger({ console: true, file: true }))  // Member 4: Logging
app.use(requestTimer({ slowThreshold: 1000 }))         // Member 4: Performance tracking
app.use(addResponseHeaders)                             // Member 5: Response headers
app.use(responseFormatter)                              // Member 5: Response formatting
app.use(trimStrings)                                    // Member 2: Trim whitespace
app.use(sanitizeRequest())                              // Member 2: XSS protection
app.use(blockInjection)                                 // Member 2: Injection prevention
app.use(normalizeRequest())                             // Member 2: Input normalization
app.use(trackActivity)                                  // Member 1: Session tracking

// Middleware
app.use(express.static(path.join(__dirname, "public")))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(express.json({ limit: '10mb' }))

// API Routes
app.use("/api", indexRoutes)
app.use("/api/auth", authRoutes)
app.use("/api/services", serviceRoutes)
app.use("/api/supplies", supplyRoutes)
app.use("/api/bookings", bookingRoutes)
app.use("/api/orders", orderRoutes)
app.use("/api/dashboard", dashboardRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/workers", workerRoutes)
app.use("/api/search", searchRoutes)
app.use("/api/reviews", reviewRoutes)
app.use("/api/notifications", notificationRoutes)
app.use("/api/delivery", deliveryRoutes)
app.use("/api/payment", paymentRoutes)
app.use("/api/verifier", verifierRoutes)

// Swagger API Documentation
setupSwagger(app)

// Metrics endpoint (Member 4: Monitoring) - Admin only
const { authenticateToken, authorize } = require("./middleware/jwt")
app.get("/api/metrics", authenticateToken, authorize("admin"), async (req, res) => {
  const cacheInfo = await getCacheStats()
  res.json({
    success: true,
    data: {
      performance: getMetrics(),
      cache: cacheInfo
    }
  })
})

// Socket.io connection
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id)

  // Authenticate socket connection
  socket.on("authenticate", (token) => {
    try {
      const jwt = require("jsonwebtoken")
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "skilllink-jwt-secret-2025")
      
      socket.userId = decoded.userId
      socket.userRole = decoded.role

      // Join user-specific room
      socket.join(`user-${decoded.userId}`)
      // Join role-specific room
      socket.join(`role-${decoded.role}`)
      
      socket.emit("authenticated", { success: true })
      console.log(`User ${decoded.userId} authenticated on socket ${socket.id}`)
    } catch (error) {
      socket.emit("authenticated", { success: false, error: "Invalid token" })
    }
  })

  // Handle location updates
  socket.on("location-update", (data) => {
    if (socket.userId) {
      // Broadcast location to relevant users
      socket.broadcast.to(`booking-${data.bookingId}`).emit("location-updated", {
        userId: socket.userId,
        location: data.location,
        timestamp: new Date(),
      })
    }
  })

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id)
  })
})

// Error handling middleware (Member 5)
app.use(notFoundHandler)  // 404 handler
app.use(errorLogger())    // Log errors (Member 4)
app.use(errorHandler)     // Centralized error handling (Member 5)

// Start server if executed directly
if (require.main === module) {
  const PORT = process.env.PORT || 5005
  server.listen(PORT, () => {
    console.log(`🚀 Backend API server running on port ${PORT}`)
    console.log(`📡 Socket.IO enabled for real-time features`)
  })
}

module.exports = app