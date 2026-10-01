const mongoose = require("mongoose")
const { MongoMemoryServer } = require("mongodb-memory-server")
const bcrypt = require("bcryptjs")
const User = require("../models/User")

let mongoServer

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  await mongoose.connect(mongoServer.getUri())
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})

afterEach(async () => {
  await User.deleteMany({})
})

describe("User Model", () => {
  const validUserData = {
    name: "Test User",
    email: "test@example.com",
    password: "hashed_password_123",
    phone: "9876543210",
    role: "customer",
  }

  test("should create a user with valid data", async () => {
    const user = new User(validUserData)
    const saved = await user.save()
    expect(saved._id).toBeDefined()
    expect(saved.name).toBe("Test User")
    expect(saved.email).toBe("test@example.com")
    expect(saved.role).toBe("customer")
    expect(saved.verification_status).toBe("Approved")
  })

  test("should enforce unique email constraint", async () => {
    await User.init()
    await new User(validUserData).save()
    const duplicate = new User({ ...validUserData, name: "Another User" })
    await expect(duplicate.save()).rejects.toThrow()
  })

  test("should default verification_status to Approved", async () => {
    const user = await new User(validUserData).save()
    expect(user.verification_status).toBe("Approved")
  })

  test("should accept valid roles", async () => {
    const roles = ["customer", "worker", "seller", "admin", "delivery", "verifier"]
    for (const role of roles) {
      const user = new User({
        ...validUserData,
        email: `${role}@example.com`,
        role,
      })
      const saved = await user.save()
      expect(saved.role).toBe(role)
    }
  })

  test("should reject invalid role", async () => {
    const user = new User({ ...validUserData, role: "superadmin" })
    await expect(user.save()).rejects.toThrow()
  })

  test("should not store plain text password directly", async () => {
    const plainPassword = "TestPassword@123"
    const hashed = await bcrypt.hash(plainPassword, 10)
    const user = await new User({ ...validUserData, password: hashed }).save()
    expect(user.password).not.toBe(plainPassword)
    expect(await bcrypt.compare(plainPassword, user.password)).toBe(true)
  })

  test("should find user by email", async () => {
    await new User(validUserData).save()
    const found = await User.findOne({ email: "test@example.com" })
    expect(found).not.toBeNull()
    expect(found.name).toBe("Test User")
  })

  test("should update user verification status", async () => {
    const user = await new User(validUserData).save()
    user.verification_status = "Approved"
    const updated = await user.save()
    expect(updated.verification_status).toBe("Approved")
  })

  test("should handle address fields", async () => {
    const user = await new User({
      ...validUserData,
      address: {
        street: "123 Main St",
        city: "Hyderabad",
        state: "Telangana",
        zipCode: "500001",
      },
    }).save()
    expect(user.address.city).toBe("Hyderabad")
    expect(user.address.state).toBe("Telangana")
  })

  test("should default isEmailVerified to false", async () => {
    const user = await new User(validUserData).save()
    expect(user.isEmailVerified).toBe(false)
  })
})
