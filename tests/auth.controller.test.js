const mongoose = require("mongoose")
const { MongoMemoryServer } = require("mongodb-memory-server")
const authController = require("../controllers/authControllerAPI")
const User = require("../models/User")
const bcrypt = require("bcryptjs")

describe("Auth Controller Unit & Integration Tests", () => {
  let mongoServer

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create()
    await mongoose.connect(mongoServer.getUri())
  })

  afterAll(async () => {
    await mongoose.disconnect()
    await mongoServer.stop()
  })

  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase()
    await User.init()
  })

  describe("register", () => {
    it("should return 400 if required fields are missing", async () => {
      const req = { body: { email: "test@example.com" } }
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }

      await authController.register(req, res)
      expect(res.status).toHaveBeenCalledWith(400)
    })

    it("should register a new user successfully", async () => {
      const req = {
        body: {
          name: "Alice Smith",
          email: "alice@example.com",
          password: "Password123!",
          phone: "9876543210",
          role: "customer",
        },
      }
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }

      await authController.register(req, res)
      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringMatching(/successful/i),
        })
      )

      const savedUser = await User.findOne({ email: "alice@example.com" })
      expect(savedUser).not.toBeNull()
      expect(savedUser.name).toBe("Alice Smith")
    })

    it("should return 400 if email is already registered", async () => {
      const hashedPassword = await bcrypt.hash("Password123!", 10)
      await User.create({
        name: "Existing User",
        email: "alice@example.com",
        password: hashedPassword,
        phone: "9876543210",
        role: "customer",
      })

      const req = {
        body: {
          name: "Alice Smith",
          email: "alice@example.com",
          password: "Password123!",
          phone: "9876543210",
          role: "customer",
        },
      }
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }

      await authController.register(req, res)
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: "Email already registered",
        })
      )
    })
  })

  describe("login", () => {
    beforeEach(async () => {
      const hashedPassword = await bcrypt.hash("Password123!", 10)
      await User.create({
        name: "Bob Builder",
        email: "bob@example.com",
        password: hashedPassword,
        phone: "9876543210",
        role: "worker",
        verification_status: "Approved",
      })
    })

    it("should return 400 if email or password is missing", async () => {
      const req = { body: { email: "bob@example.com" } }
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }

      await authController.login(req, res)
      expect(res.status).toHaveBeenCalledWith(400)
    })

    it("should return 401 if password is wrong", async () => {
      const req = { body: { email: "bob@example.com", password: "wrongpassword" } }
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }

      await authController.login(req, res)
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it("should login user successfully with valid credentials", async () => {
      const req = { body: { email: "bob@example.com", password: "Password123!" } }
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }

      await authController.login(req, res)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          token: expect.any(String),
          user: expect.objectContaining({ email: "bob@example.com", role: "worker" }),
        })
      )
    })
  })
})
