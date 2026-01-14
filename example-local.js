/**
 * Local example demonstrating API Client features
 * Run with: node example-local.js
 */

const { ApiClient, ApiError, createApiClient, withAuth, withLogging } = require('./src/utils/api-client');

console.log('=== API Client Utility Demo ===\n');

// 1. Creating a client
console.log('1. Creating an API client:');
const api = createApiClient('https://api.example.com', {
  timeout: 5000,
  retries: 3,
  cacheEnabled: true,
  cacheTTL: 60000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});
console.log('   Client created with baseUrl:', api.baseUrl);
console.log('   Timeout:', api.timeout, 'ms');
console.log('   Retries:', api.retries);
console.log('   Cache enabled:', api.cacheEnabled);

// 2. Adding interceptors
console.log('\n2. Adding interceptors:');
const requestIdx = api.addRequestInterceptor((config) => {
  console.log(`   [Interceptor] Preparing ${config.method} request`);
  return config;
});
console.log('   Request interceptor added at index:', requestIdx);

const responseIdx = api.addResponseInterceptor((response) => {
  console.log(`   [Interceptor] Received response with status ${response.status}`);
  return response;
});
console.log('   Response interceptor added at index:', responseIdx);

// 3. Using withAuth helper
console.log('\n3. Adding authentication:');
withAuth(api, () => 'my-secret-token');
console.log('   Auth interceptor added (Bearer token)');

// 4. Using withLogging helper
console.log('\n4. Adding logging:');
withLogging(api, { log: (msg) => console.log('   ' + msg) });
console.log('   Logging interceptor added');

// 5. Demonstrating ApiError
console.log('\n5. ApiError example:');
const error = new ApiError('User not found', 404, { error: 'Not Found', userId: 123 });
console.log('   Error name:', error.name);
console.log('   Error message:', error.message);
console.log('   Status code:', error.statusCode);
console.log('   Response:', JSON.stringify(error.response));
console.log('   Timestamp:', error.timestamp);
console.log('   As JSON:', JSON.stringify(error.toJSON(), null, 4));

// 6. URL building demonstration
console.log('\n6. URL building (internal method):');
const url1 = api._buildUrl('/users', { page: 1, limit: 10 });
console.log('   /users with {page:1, limit:10}:');
console.log('  ', url1);

const url2 = api._buildUrl('/search', { tags: ['js', 'node', 'api'] });
console.log('   /search with array params:');
console.log('  ', url2);

// 7. Cache operations
console.log('\n7. Cache operations:');
api._setCache('test-key', { data: { id: 1 }, status: 200 });
console.log('   Set cache for "test-key"');
const cached = api._getFromCache('test-key');
console.log('   Retrieved from cache:', JSON.stringify(cached));
api.clearCache();
console.log('   Cache cleared');
const afterClear = api._getFromCache('test-key');
console.log('   After clear:', afterClear);

// 8. Removing interceptors
console.log('\n8. Removing interceptors:');
const removed = api.removeRequestInterceptor(requestIdx);
console.log('   Removed request interceptor:', removed);

console.log('\n=== Demo Complete ===');
console.log('\nTo use with a real API, run:');
console.log('  node example.js');
console.log('\nOr import in your project:');
console.log('  const { createApiClient } = require("./src/utils/api-client");');
