# SkillLink Architecture & Engineering Design

## 1. Multi-Layer Caching: Redis + In-Memory LRU Fallback

We chose a dual-layer caching strategy (**Redis L2 + In-Memory LRU L1**) over Redis alone for three engineering reasons:

- **Resilience against Cache Infrastructure Failures**: If Redis experiences network partitions, cloud instance failure, or rate limits on free tiers, the backend gracefully falls back to an internal L1 LRU map (`Map` with max 500 entries) without throwing 500 errors or failing incoming requests.
- **Ultra-Low Latency (L1 Cache)**: Frequent GET queries (e.g., product listings, categories) are served in sub-millisecond time directly from process memory without incurring network round-trip overhead to an external Redis server.
- **Developer & Deployment Simplicity**: The application remains functional in standalone local development or lightweight container environments without enforcing a hard dependency on an external Redis instance.

---

## 2. API Design: 16 Modular Routes

The SkillLink REST API is structured into 16 domain-focused modules (`auth`, `services`, `supplies`, `bookings`, `orders`, `dashboard`, `admin`, `workers`, `search`, `reviews`, `notifications`, `delivery`, `payment`, `verifier`, etc.) rather than a centralized monolith:

- **Domain Isolation & Scoped Middleware**: Each module encapsulates its domain models and applies specific middleware stacks. For example, authentication and rate limiting are enforced on `auth` and `payment`, role-based access control is scoped to `admin`/`verifier`, and response caching is restricted to catalog endpoints (`services`/`supplies`).
- **Maintainability & Team Parallelism**: Decoupled routes allow separate engineers to work on worker management, order handling, or verifier workflows simultaneously without merge conflicts.
- **Microservices Path**: Clear domain boundaries make it straightforward to extract high-traffic modules (e.g., `notifications` or `bookings`) into independent microservices if traffic demands it.

---

## 3. 10x Scaling Trade-Off & Mitigation Plan

### What Breaks First at 10x Traffic: CPU Saturation on Bcrypt & Socket.IO State
At 10x traffic (~10,000 requests/sec), two primary bottlenecks will emerge:
1. **CPU Exhaustion via Bcrypt**: Asynchronous Bcrypt hashing (`cost factor 10`) during spike logins blocks Node.js worker event loops.
2. **Single-Node Socket.IO State**: Real-time location tracking and instant notifications depend on in-memory Socket.IO connection maps, causing memory bloat and preventing multi-instance horizontal scaling.

### Architectural Mitigations:
1. **Auth Offloading**: Migrate authentication and Bcrypt computation to a dedicated stateless Auth service or delegate token verification via lightweight JWT validation at an API gateway layer (e.g., NGINX / Kong).
2. **Horizontal Scaling with Redis Pub/Sub Adapter**: Replace single-instance Socket.IO with `@socket.io/redis-adapter` to distribute WebSocket events across stateless Node.js cluster instances.
3. **Database Read Replicas**: Provision MongoDB Atlas read replicas with secondary-preferred read preferences for search and catalog queries.
