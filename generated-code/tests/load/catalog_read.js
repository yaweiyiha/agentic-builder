import http from 'k6/http';
import { check } from 'k6';

/**
 * AeroCommerce Load Test: Catalog Read
 * 
 * Objective: Simulate 10,000 Requests Per Second (RPS) against the Apollo Router
 * to verify the <100ms p95 latency target for catalog read operations.
 * 
 * Run command:
 * k6 run tests/load/catalog_read.js
 * 
 * To specify a custom endpoint:
 * k6 run -e GRAPHQL_ENDPOINT=https://api.aerocommerce.com/graphql tests/load/catalog_read.js
 */

export const options = {
  scenarios: {
    catalog_read_load: {
      // Use ramping arrival rate to smoothly scale up to 10,000 RPS
      // and hold it there to measure sustained latency.
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 2000,
      maxVUs: 15000, // High max VUs to ensure we can hit 10k RPS even if latency spikes initially
      stages: [
        { target: 10000, duration: '30s' }, // Ramp up to 10,000 RPS over 30 seconds
        { target: 10000, duration: '1m' },  // Hold at 10,000 RPS for 1 minute
        { target: 0, duration: '15s' },     // Ramp down to 0
      ],
    },
  },
  thresholds: {
    // PRD Goal: Sub-100ms API response times for 95% of catalog read requests
    http_req_duration: ['p(95)<100'],
    
    // Ensure error rate remains below 1% under heavy load
    http_req_failed: ['rate<0.01'],
  },
};

// Default to local Apollo Router if environment variable is not set
const GRAPHQL_ENDPOINT = __ENV.GRAPHQL_ENDPOINT || 'http://localhost:4000/graphql';

// GraphQL query simulating a standard storefront catalog read (e.g., category page)
const CATALOG_QUERY = `
  query GetCatalogProducts($limit: Int!, $offset: Int!) {
    products(limit: $limit, offset: $offset) {
      id
      name
      slug
      description
      price {
        amount
        currency
      }
      inventory {
        available
        quantity
      }
      vendor {
        id
        name
      }
    }
  }
`;

export default function () {
  // Randomize offset to simulate realistic user behavior and prevent 
  // the edge cache from serving a single perfectly cached response for all 10k RPS.
  // This ensures we test the actual cache hit/miss ratio and backend performance.
  const randomOffset = Math.floor(Math.random() * 50) * 20;

  const payload = JSON.stringify({
    query: CATALOG_QUERY,
    variables: {
      limit: 20,
      offset: randomOffset,
    },
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'k6-aerocommerce-load-test',
      // Optional: Add headers to simulate specific client types or bypass certain WAF rules if needed
      // 'x-client-name': 'aerocommerce-storefront',
    },
  };

  const res = http.post(GRAPHQL_ENDPOINT, payload, params);

  // Validate the response
  check(res, {
    'is status 200': (r) => r.status === 200,
    'no graphql errors': (r) => {
      try {
        const body = r.json();
        return body && !body.errors;
      } catch (e) {
        return false;
      }
    },
    'has product data': (r) => {
      try {
        const body = r.json();
        return body && body.data && Array.isArray(body.data.products);
      } catch (e) {
        return false;
      }
    }
  });
}
