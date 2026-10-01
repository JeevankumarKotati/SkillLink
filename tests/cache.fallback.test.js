const redisClientUtil = require("../utils/redisClient")
const cacheMiddleware = require("../middleware/cache")

describe("Redis-to-LRU Cache Fallback Behavior", () => {
  beforeEach(async () => {
    // Reset cache before each test
    await redisClientUtil.cacheDel("*")
  })

  describe("utils/redisClient.js In-Memory LRU Fallback", () => {
    it("should report non-connected Redis and in-memory backend", async () => {
      const info = await redisClientUtil.getCacheInfo()
      expect(info.backend).toBe("in-memory")
      expect(info.connected).toBe(false)
    })

    it("should set, get, and delete values from in-memory fallback", async () => {
      const key = "test:key:1"
      const data = { id: 100, name: "Plumbing Service" }

      await redisClientUtil.cacheSet(key, data, 10)
      const fetched = await redisClientUtil.cacheGet(key)
      expect(fetched).toEqual(data)

      await redisClientUtil.cacheDel(key)
      const afterDel = await redisClientUtil.cacheGet(key)
      expect(afterDel).toBeNull()
    })

    it("should return null for expired cache items in fallback", async () => {
      const key = "test:key:expired"
      const data = { temp: "data" }

      // Set with 1 second TTL
      await redisClientUtil.cacheSet(key, data, 1)

      // Fast-forward time / mock Date.now
      const realNow = Date.now
      Date.now = jest.fn(() => realNow() + 2000)

      const result = await redisClientUtil.cacheGet(key)
      expect(result).toBeNull()

      Date.now = realNow
    })

    it("should enforce LRU capacity limit by evicting oldest item when full", async () => {
      // Fill up cache past 500 items to test eviction logic
      for (let i = 0; i < 505; i++) {
        await redisClientUtil.cacheSet(`key:${i}`, { val: i }, 300)
      }

      const info = await redisClientUtil.getCacheInfo()
      expect(info.entries).toBeLessThanOrEqual(500)

      // Key 0 should have been evicted
      const key0 = await redisClientUtil.cacheGet("key:0")
      expect(key0).toBeNull()

      // Key 504 should exist
      const key504 = await redisClientUtil.cacheGet("key:504")
      expect(key504).toEqual({ val: 504 })
    })

    it("should support wildcard pattern deletion in fallback", async () => {
      await redisClientUtil.cacheSet("services:plumbing", { id: 1 }, 300)
      await redisClientUtil.cacheSet("services:electrical", { id: 2 }, 300)
      await redisClientUtil.cacheSet("products:pipe", { id: 3 }, 300)

      await redisClientUtil.cacheDel("services:*")

      expect(await redisClientUtil.cacheGet("services:plumbing")).toBeNull()
      expect(await redisClientUtil.cacheGet("services:electrical")).toBeNull()
      expect(await redisClientUtil.cacheGet("products:pipe")).not.toBeNull()
    })
  })

  describe("middleware/cache.js Integration", () => {
    it("should generate proper cache keys based on request method and URL", () => {
      const req = { method: "GET", originalUrl: "/api/services?cat=plumbing" }
      const key = cacheMiddleware.generateCacheKey(req, { varyByQuery: true })
      expect(key).toContain("GET")
      expect(key).toContain("/api/services")
    })

    it("should attach X-Cache headers (MISS then HIT) on response caching", async () => {
      const middleware = cacheMiddleware.cacheResponse({ ttl: 5000 })

      const req = { method: "GET", url: "/api/test-cache-header" }
      const headers = {}
      const res = {
        statusCode: 200,
        setHeader: jest.fn((h, v) => { headers[h] = v }),
        status: jest.fn().mockReturnThis(),
        json: jest.fn((body) => body),
      }
      const next = jest.fn()

      // First call -> MISS
      await middleware(req, res, next)
      expect(next).toHaveBeenCalled()

      // Simulate sending response
      res.json({ message: "cached content" })

      // Wait brief moment for async cacheSet
      await new Promise(r => setTimeout(r, 50))

      // Second call -> HIT
      const req2 = { method: "GET", url: "/api/test-cache-header" }
      const headers2 = {}
      const res2 = {
        statusCode: 200,
        setHeader: jest.fn((h, v) => { headers2[h] = v }),
        status: jest.fn().mockReturnThis(),
        json: jest.fn((body) => body),
      }
      const next2 = jest.fn()

      await middleware(req2, res2, next2)

      expect(headers2["X-Cache"]).toBe("HIT")
      expect(headers2["X-Cache-Backend"]).toBe("memory")
      expect(res2.json).toHaveBeenCalledWith({ message: "cached content" })
    })

    it("should return valid cache stats including hit rate and backend", async () => {
      const stats = await cacheMiddleware.getCacheStats()
      expect(stats).toHaveProperty("hits")
      expect(stats).toHaveProperty("misses")
      expect(stats).toHaveProperty("hitRate")
      expect(stats.backend).toBe("in-memory")
    })
  })
})
