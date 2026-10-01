const { handleValidationErrors } = require("../middleware/validation")
const { sanitizeRequest, blockInjection } = require("../middleware/sanitizer")
const { normalizeRequest, trimStrings } = require("../middleware/inputNormalizer")
const { responseFormatter, addResponseHeaders } = require("../middleware/responseFormatter")
const { errorHandler, notFoundHandler } = require("../middleware/errorHandler")

describe("Core Middleware Unit Tests", () => {
  let req, res, next

  beforeEach(() => {
    req = { body: {}, query: {}, params: {}, headers: {} }
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
    }
    next = jest.fn()
  })

  describe("Validation Middleware", () => {
    it("should call next() if no validation errors exist", () => {
      handleValidationErrors(req, res, next)
      expect(next).toHaveBeenCalled()
    })
  })

  describe("Sanitizer & Normalizer Middleware", () => {
    it("should trim string fields in request body", () => {
      req.body = { name: "  John Doe  ", age: 30 }
      trimStrings(req, res, next)
      expect(req.body.name).toBe("John Doe")
      expect(req.body.age).toBe(30)
      expect(next).toHaveBeenCalled()
    })

    it("should sanitize script tags from request body", () => {
      req.body = { comment: "<script>alert('xss')</script>Hello" }
      const middleware = sanitizeRequest()
      middleware(req, res, next)
      expect(req.body.comment).not.toContain("<script>")
      expect(next).toHaveBeenCalled()
    })

    it("should block SQL injection attempt in string input", () => {
      req.body = { comment: "SELECT * FROM users WHERE 1 = 1" }
      blockInjection(req, res, next)
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: "INJECTION_BLOCKED",
        })
      )
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe("Response Formatter & Error Handler Middleware", () => {
    it("should attach security and custom response headers", () => {
      addResponseHeaders(req, res, next)
      expect(res.setHeader).toHaveBeenCalledWith("X-API-Version", "1.0")
      expect(next).toHaveBeenCalled()
    })

    it("should pass 404 ApiError to next() for unknown endpoints", () => {
      req.method = "GET"
      req.originalUrl = "/api/unknown-endpoint"
      notFoundHandler(req, res, next)
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          code: "NOT_FOUND",
        })
      )
    })

    it("should catch and format internal server errors cleanly", () => {
      const err = new Error("Database connection dropped")
      errorHandler(err, req, res, next)
      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: "Database connection dropped",
          }),
        })
      )
    })
  })
})
