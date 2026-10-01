import http from 'k6/http';
import { check, sleep } from 'k6';

// k6 Load Test Configuration for SkillLink High-Traffic Endpoints
export const options = {
  stages: [
    { duration: '30s', target: 50 },   // Low load: 50 concurrent virtual users
    { duration: '1m',  target: 200 },  // Medium load: 200 concurrent virtual users
    { duration: '1m',  target: 500 },  // High load: 500 concurrent virtual users
    { duration: '30s', target: 0 },    // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must complete within 500ms
    http_req_failed: ['rate<0.05'],   // Error rate must be under 5%
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5005';

export default function () {
  // 1. Endpoint: GET /api/services (Job / Service Listing)
  const resServices = http.get(`${BASE_URL}/api/services`);
  check(resServices, {
    'services status is 200': (r) => r.status === 200,
    'services returned list': (r) => r.json('services') !== undefined,
  });

  sleep(0.5);

  // 2. Endpoint: POST /api/auth/login (User Login)
  const loginPayload = JSON.stringify({
    email: 'customer@skilllink.com',
    password: 'password123',
  });
  const loginHeaders = { 'Content-Type': 'application/json' };
  
  const resLogin = http.post(`${BASE_URL}/api/auth/login`, loginPayload, { headers: loginHeaders });
  const loginSuccess = check(resLogin, {
    'login status is 200 or 403': (r) => r.status === 200 || r.status === 403,
  });

  let token = null;
  if (resLogin.status === 200 && resLogin.json('token')) {
    token = resLogin.json('token');
  }

  sleep(0.5);

  // 3. Endpoint: POST /api/bookings (Booking Creation)
  if (token) {
    const bookingPayload = JSON.stringify({
      service: '65c1a2b3c4d5e6f7a8b9c0d1',
      worker: '65c1a2b3c4d5e6f7a8b9c0d2',
      date: '2026-10-15',
      time: '10:00 AM',
      address: '123 Load Test Way, Metro City',
    });
    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };

    const resBooking = http.post(`${BASE_URL}/api/bookings`, bookingPayload, { headers: authHeaders });
    check(resBooking, {
      'booking status is 201 or 400': (r) => r.status === 201 || r.status === 400,
    });
  }

  sleep(1);
}
