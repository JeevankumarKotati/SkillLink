const {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  authenticateToken,
  authorize,
} = require("../middleware/jwt")

describe("JWT Middleware Unit & Integration Tests", () => {
  const mockUser = { userId: "507f1f77bcf86cd799439011", role: "customer" }

  describe("Token Generation & Verification", () => {
    it("should generate and verify a valid access token", () => {
      const token = generateAccessToken(mockUser.userId, mockUser.role)
      expect(token).toBeDefined()
      expect(typeof token).toBe("string")

      const decoded = verifyAccessToken(token)
      expect(decoded).not.toBeNull()
      expect(decoded.userId).toBe(mockUser.userId)
      expect(decoded.role).toBe(mockUser.role)
    })

    it("should generate and verify a valid refresh token", () => {
      const token = generateRefreshToken(mockUser.userId, mockUser.role)
      expect(token).toBeDefined()

      const decoded = verifyRefreshToken(token)
      expect(decoded).not.toBeNull()
      expect(decoded.userId).toBe(mockUser.userId)
      expect(decoded.role).toBe(mockUser.role)
    })

    it("should return null for an invalid access token", () => {
      const decoded = verifyAccessToken("invalid.jwt.token")
      expect(decoded).toBeNull()
    })

    it("should return null for an invalid refresh token", () => {
      const decoded = verifyRefreshToken("invalid.jwt.token")
      expect(decoded).toBeNull()
    })
  })

  describe("authenticateToken Middleware", () => {
    let req, res, next

    beforeEach(() => {
      req = { headers: {} }
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }
      next = jest.fn()
    })

    it("should return 401 if authorization header is missing", () => {
      authenticateToken(req, res, next)
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Access token required",
      })
      expect(next).not.toHaveBeenCalled()
    })

    it("should return 401 if Bearer token is empty", () => {
      req.headers["authorization"] = "Bearer "
      authenticateToken(req, res, next)
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Access token required",
      })
      expect(next).not.toHaveBeenCalled()
    })

    it("should return 403 if token is invalid or expired", () => {
      req.headers["authorization"] = "Bearer invalidtoken123"
      authenticateToken(req, res, next)
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Invalid or expired token",
      })
      expect(next).not.toHaveBeenCalled()
    })

    it("should populate req.user and call next() if valid token is provided", () => {
      const validToken = generateAccessToken(mockUser.userId, mockUser.role)
      req.headers["authorization"] = `Bearer ${validToken}`

      authenticateToken(req, res, next)
      expect(req.user).toBeDefined()
      expect(req.user.userId).toBe(mockUser.userId)
      expect(req.user.role).toBe(mockUser.role)
      expect(next).toHaveBeenCalled()
    })
  })

  describe("authorize Middleware", () => {
    let req, res, next

    beforeEach(() => {
      req = {}
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      }
      next = jest.fn()
    })

    it("should return 401 if req.user is missing", () => {
      const middleware = authorize("customer", "admin")
      middleware(req, res, next)
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Unauthorized",
      })
      expect(next).not.toHaveBeenCalled()
    })

    it("should return 403 if user role is not authorized", () => {
      req.user = { userId: "123", role: "worker" }
      const middleware = authorize("customer", "admin")
      middleware(req, res, next)
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Access denied. Insufficient permissions",
      })
      expect(next).not.toHaveBeenCalled()
    })

    it("should call next() if user role is authorized", () => {
      req.user = { userId: "123", role: "admin" }
      const middleware = authorize("customer", "admin")
      middleware(req, res, next)
      expect(next).toHaveBeenCalled()
    })
  })
})
