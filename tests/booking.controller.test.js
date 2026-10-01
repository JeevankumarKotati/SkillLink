const mongoose = require("mongoose")
const { MongoMemoryServer } = require("mongodb-memory-server")
const bookingController = require("../controllers/bookingControllerAPI")
const Booking = require("../models/Booking")
const Service = require("../models/Service")
const Worker = require("../models/Worker")
const User = require("../models/User")
const Notification = require("../models/Notification")

describe("Booking Creation & Management Controller Logic", () => {
  let mongoServer
  let customerUser, workerUser, serviceDoc, workerDoc

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create()
    const uri = mongoServer.getUri()
    await mongoose.connect(uri)
  })

  afterAll(async () => {
    await mongoose.disconnect()
    await mongoServer.stop()
  })

  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase()

    // Create test customer
    customerUser = await User.create({
      name: "Customer John",
      email: "customer@example.com",
      password: "password123",
      role: "customer",
      phone: "+919876543210",
    })

    // Create test worker user & worker doc
    workerUser = await User.create({
      name: "Worker Bob",
      email: "worker@example.com",
      password: "password123",
      role: "worker",
      phone: "+919876543211",
    })

    workerDoc = await Worker.create({
      user: workerUser._id,
      serviceCategory: "plumber",
      skills: ["pipe fixing", "leak repair"],
      isAvailable: true,
      isVerified: true,
      pricing: [{ serviceName: "Pipe Leak Repair", price: 450 }],
    })

    // Create test service
    serviceDoc = await Service.create({
      name: "Pipe Leak Repair",
      description: "Fixing leaking pipes",
      category: "plumber",
      price: 400,
    })
  })

  describe("createBooking", () => {
    it("should return 400 if required fields are missing", async () => {
      const req = {
        user: { userId: customerUser._id.toString() },
        body: {
          service: serviceDoc._id.toString(),
          // missing worker, date, time, address
        },
      }
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }

      await bookingController.createBooking(req, res)
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: "Service, worker, date, time, and address are required",
        })
      )
    })

    it("should return 404 if service does not exist", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString()
      const req = {
        user: { userId: customerUser._id.toString() },
        body: {
          service: fakeId,
          worker: workerDoc._id.toString(),
          date: "2026-10-15",
          time: "10:00 AM",
          address: "123 Main St",
        },
      }
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }

      await bookingController.createBooking(req, res)
      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Service not found",
      })
    })

    it("should return 404 if worker does not exist", async () => {
      const fakeWorkerId = new mongoose.Types.ObjectId().toString()
      const req = {
        user: { userId: customerUser._id.toString() },
        body: {
          service: serviceDoc._id.toString(),
          worker: fakeWorkerId,
          date: "2026-10-15",
          time: "10:00 AM",
          address: "123 Main St",
        },
      }
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }

      await bookingController.createBooking(req, res)
      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Worker not found",
      })
    })

    it("should return 400 if worker is not available", async () => {
      workerDoc.isAvailable = false
      await workerDoc.save()

      const req = {
        user: { userId: customerUser._id.toString() },
        body: {
          service: serviceDoc._id.toString(),
          worker: workerDoc._id.toString(),
          date: "2026-10-15",
          time: "10:00 AM",
          address: "123 Main St",
        },
      }
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }

      await bookingController.createBooking(req, res)
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        })
      )
    })

    it("should create booking successfully with worker pricing override", async () => {
      const req = {
        user: { userId: customerUser._id.toString() },
        body: {
          service: serviceDoc._id.toString(),
          worker: workerDoc._id.toString(),
          date: "2026-10-15",
          time: "10:00 AM",
          address: "456 Oak Avenue",
          notes: "Ring doorbell on arrival",
        },
      }
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }

      await bookingController.createBooking(req, res)
      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "Booking created successfully",
        })
      )

      // Verify DB record created
      const created = await Booking.findOne({ customer: customerUser._id })
      expect(created).not.toBeNull()
      expect(created.address).toBe("456 Oak Avenue")
      expect(created.price).toBe(450) // Worker's pricing override
      expect(created.status).toBe("pending")
    })
  })

  describe("getUserBookings & updateBookingStatus", () => {
    let testBooking

    beforeEach(async () => {
      testBooking = await Booking.create({
        customer: customerUser._id,
        worker: workerDoc._id,
        service: serviceDoc._id,
        date: new Date("2026-10-20"),
        time: "02:00 PM",
        address: "789 Pine St",
        price: 400,
        status: "pending",
      })
    })

    it("should fetch user bookings for customer", async () => {
      const req = {
        user: { userId: customerUser._id.toString(), role: "customer" },
        query: {},
      }
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }

      await bookingController.getUserBookings(req, res)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          bookings: expect.any(Array),
        })
      )
    })

    it("should accept booking as worker", async () => {
      const req = {
        user: { userId: workerUser._id.toString(), role: "worker" },
        params: { id: testBooking._id.toString() },
      }
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }

      await bookingController.acceptBooking(req, res)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringMatching(/accepted/i),
        })
      )

      const updated = await Booking.findById(testBooking._id)
      expect(updated.status).toBe("accepted")
    })

    it("should cancel booking as customer", async () => {
      const req = {
        user: { userId: customerUser._id.toString(), role: "customer" },
        params: { id: testBooking._id.toString() },
        body: { reason: "Plans changed" },
      }
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }

      await bookingController.cancelBooking(req, res)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringMatching(/cancelled/i),
        })
      )

      const updated = await Booking.findById(testBooking._id)
      expect(updated.status).toBe("cancelled")
    })
  })
})
