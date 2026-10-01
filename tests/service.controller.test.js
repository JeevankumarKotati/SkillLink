const mongoose = require("mongoose")
const { MongoMemoryServer } = require("mongodb-memory-server")
const serviceController = require("../controllers/serviceControllerAPI")
const Service = require("../models/Service")

describe("Service Controller Unit & Integration Tests", () => {
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
    await Service.create([
      { name: "Faucet Fix", category: "plumber", price: 300, isAvailable: true },
      { name: "Wiring Repair", category: "electrician", price: 500, isAvailable: true },
      { name: "Door Hinge", category: "carpenter", price: 250, isAvailable: false },
    ])
  })

  it("should get all services", async () => {
    const req = { query: {} }
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }

    await serviceController.getAllServices(req, res)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        services: expect.arrayContaining([
          expect.objectContaining({ name: "Faucet Fix" }),
        ]),
      })
    )
  })

  it("should filter services by category", async () => {
    const req = { query: { category: "electrician" } }
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }

    await serviceController.getAllServices(req, res)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        services: expect.arrayContaining([
          expect.objectContaining({ category: "electrician" }),
        ]),
      })
    )
  })

  it("should return 404 for non-existent service ID", async () => {
    const req = { params: { id: new mongoose.Types.ObjectId().toString() } }
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }

    await serviceController.getServiceById(req, res)
    expect(res.status).toHaveBeenCalledWith(404)
  })
})
