# API Client Utility

A robust, configurable HTTP client for making API requests with built-in support for interceptors, retry logic, caching, and comprehensive error handling.

## Features

- **Request/Response Interceptors**: Middleware-like functionality for modifying requests and responses
- **Automatic Retry**: Exponential backoff for transient failures (5xx errors, timeouts, network issues)
- **Response Caching**: Configurable TTL-based caching for GET requests
- **Timeout Handling**: AbortController-based request timeouts
- **Comprehensive Errors**: Detailed error objects with status codes, responses, and timestamps

## Installation

```bash
# Copy the api-client.js file to your project
cp src/utils/api-client.js your-project/src/utils/
```

## Quick Start

```javascript
const { createApiClient, withAuth, withLogging } = require('./utils/api-client');

// Create a client
const api = createApiClient('https://api.example.com', {
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
});

// Add authentication
withAuth(api, () => localStorage.getItem('token'));

// Make requests
const { data: users } = await api.get('/users');
const { data: newUser } = await api.post('/users', { name: 'John' });
```

## API Reference

### `createApiClient(baseUrl, options)`

Factory function to create a new API client instance.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `baseUrl` | `string` | required | Base URL for all requests |
| `options.timeout` | `number` | `30000` | Request timeout in milliseconds |
| `options.retries` | `number` | `3` | Number of retry attempts |
| `options.headers` | `object` | `{}` | Default headers for all requests |
| `options.cacheEnabled` | `boolean` | `false` | Enable response caching |
| `options.cacheTTL` | `number` | `60000` | Cache TTL in milliseconds |

**Returns:** `ApiClient` instance

**Example:**

```javascript
const api = createApiClient('https://api.example.com', {
  timeout: 15000,
  retries: 5,
  cacheEnabled: true,
  cacheTTL: 300000, // 5 minutes
  headers: {
    'Accept': 'application/json',
    'X-API-Version': '2.0'
  }
});
```

---

### `ApiClient`

The main HTTP client class.

#### Constructor

```javascript
new ApiClient(baseUrl, options)
```

#### Methods

##### `get(endpoint, options)`

Makes a GET request.

```javascript
// Simple GET
const { data } = await api.get('/users');

// GET with query parameters
const { data } = await api.get('/users', {
  params: { page: 1, limit: 20, status: 'active' }
});
// URL: /users?page=1&limit=20&status=active

// GET with array parameters
const { data } = await api.get('/search', {
  params: { tags: ['javascript', 'nodejs'] }
});
// URL: /search?tags=javascript&tags=nodejs
```

##### `post(endpoint, body, options)`

Makes a POST request.

```javascript
const { data } = await api.post('/users', {
  name: 'John Doe',
  email: 'john@example.com'
});
```

##### `put(endpoint, body, options)`

Makes a PUT request (full resource replacement).

```javascript
const { data } = await api.put('/users/123', {
  name: 'John Smith',
  email: 'johnsmith@example.com',
  role: 'admin'
});
```

##### `patch(endpoint, body, options)`

Makes a PATCH request (partial update).

```javascript
const { data } = await api.patch('/users/123', {
  email: 'newemail@example.com'
});
```

##### `delete(endpoint, options)`

Makes a DELETE request.

```javascript
await api.delete('/users/123');

// Bulk delete
await api.delete('/notifications', {
  params: { ids: [1, 2, 3] }
});
```

##### `request(method, endpoint, options)`

Core method for making any HTTP request.

```javascript
const response = await api.request('GET', '/users', {
  params: { page: 1 },
  headers: { 'X-Custom': 'value' },
  timeout: 5000,
  useCache: false
});
```

---

### Request Options

All request methods accept an options object:

| Option | Type | Description |
|--------|------|-------------|
| `params` | `object` | URL query parameters |
| `body` | `object` | Request body (auto JSON-stringified) |
| `headers` | `object` | Request-specific headers |
| `timeout` | `number` | Override default timeout |
| `useCache` | `boolean` | Enable/disable caching for this request |

---

### Interceptors

Interceptors allow you to modify requests before they're sent and responses after they're received.

#### `addRequestInterceptor(interceptor)`

```javascript
// Add auth token to all requests
const authIndex = api.addRequestInterceptor(async (config) => {
  const token = await getToken();
  config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});

// Log all requests
api.addRequestInterceptor((config) => {
  console.log(`${config.method} ${config.url}`);
  return config;
});
```

#### `addResponseInterceptor(interceptor)`

```javascript
// Unwrap API response format
api.addResponseInterceptor((response) => {
  // API returns { success: true, data: {...} }
  if (response.data && response.data.data) {
    response.data = response.data.data;
  }
  return response;
});

// Add timing metadata
api.addResponseInterceptor((response) => ({
  ...response,
  receivedAt: Date.now()
}));
```

#### `removeRequestInterceptor(index)` / `removeResponseInterceptor(index)`

```javascript
const index = api.addRequestInterceptor(myInterceptor);
// Later...
api.removeRequestInterceptor(index); // Returns true if successful
```

---

### Caching

Enable caching for GET requests to reduce API calls:

```javascript
const api = createApiClient('https://api.example.com', {
  cacheEnabled: true,
  cacheTTL: 60000 // 1 minute
});

// First call fetches from server
const { data } = await api.get('/users');

// Second call returns cached data (within TTL)
const { data: cached } = await api.get('/users');

// Force fresh data
const { data: fresh } = await api.get('/users', { useCache: false });

// Clear all cached data
api.clearCache();
```

---

### Error Handling

The client throws `ApiError` instances for all failures:

```javascript
const { ApiError } = require('./utils/api-client');

try {
  await api.get('/users/999');
} catch (error) {
  if (error instanceof ApiError) {
    console.log('Status:', error.statusCode);    // 404
    console.log('Message:', error.message);      // "HTTP 404: Not Found"
    console.log('Response:', error.response);    // Server error body
    console.log('Timestamp:', error.timestamp);  // ISO 8601 string

    // Handle specific errors
    switch (error.statusCode) {
      case 401:
        redirectToLogin();
        break;
      case 404:
        showNotFoundMessage();
        break;
      case 429:
        // Rate limited - already retried, show error
        showRateLimitError();
        break;
      default:
        showGenericError(error.message);
    }

    // Log as JSON for monitoring
    logger.error(JSON.stringify(error.toJSON()));
  }
}
```

#### Automatic Retries

The following errors trigger automatic retry with exponential backoff:

- `408` Request Timeout
- `429` Too Many Requests
- `500` Internal Server Error
- `502` Bad Gateway
- `503` Service Unavailable
- `504` Gateway Timeout
- Network errors (connection issues)

Retry delays: 1s, 2s, 4s, 8s... (exponential backoff)

---

### Helper Functions

#### `withAuth(client, tokenProvider)`

Adds Bearer token authentication to all requests.

```javascript
// Static token
withAuth(api, 'my-api-key');

// Dynamic token
withAuth(api, () => localStorage.getItem('token'));

// Async token with refresh
withAuth(api, async () => {
  const token = getStoredToken();
  if (isExpired(token)) {
    return await refreshToken();
  }
  return token;
});
```

#### `withLogging(client, logger)`

Adds request/response logging.

```javascript
// Use console (default)
withLogging(api);

// Custom logger
withLogging(api, {
  log: (msg) => winston.info(msg)
});

// Output:
// [API Request] GET https://api.example.com/users
// [API Response] Status: 200
```

---

### Response Object

All requests return a response object:

```javascript
const response = await api.get('/users');

// Structure:
{
  data: [...],           // Parsed response body (JSON or text)
  status: 200,           // HTTP status code
  headers: Headers {...} // Response headers
}
```

---

## Complete Example

```javascript
const {
  createApiClient,
  withAuth,
  withLogging,
  ApiError
} = require('./utils/api-client');

// Create configured client
const api = createApiClient('https://api.myapp.com/v1', {
  timeout: 15000,
  retries: 3,
  cacheEnabled: true,
  cacheTTL: 60000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

// Add authentication
withAuth(api, async () => {
  const auth = JSON.parse(localStorage.getItem('auth'));
  if (auth && Date.now() > auth.expiresAt) {
    const newAuth = await refreshAuthToken(auth.refreshToken);
    localStorage.setItem('auth', JSON.stringify(newAuth));
    return newAuth.accessToken;
  }
  return auth?.accessToken;
});

// Add logging in development
if (process.env.NODE_ENV === 'development') {
  withLogging(api);
}

// API service functions
async function getUsers(page = 1, limit = 20) {
  const { data } = await api.get('/users', {
    params: { page, limit, sort: '-createdAt' }
  });
  return data;
}

async function createUser(userData) {
  const { data } = await api.post('/users', userData);
  return data;
}

async function updateUser(id, updates) {
  const { data } = await api.patch(`/users/${id}`, updates);
  api.clearCache(); // Invalidate user list cache
  return data;
}

async function deleteUser(id) {
  await api.delete(`/users/${id}`);
  api.clearCache();
}

// Usage with error handling
async function main() {
  try {
    const users = await getUsers();
    console.log(`Found ${users.length} users`);

    const newUser = await createUser({
      name: 'Jane Doe',
      email: 'jane@example.com'
    });
    console.log(`Created user: ${newUser.id}`);

  } catch (error) {
    if (error instanceof ApiError) {
      if (error.statusCode === 401) {
        // Redirect to login
        window.location.href = '/login';
      } else {
        console.error(`API Error: ${error.message}`);
      }
    } else {
      console.error('Unexpected error:', error);
    }
  }
}

module.exports = { api, getUsers, createUser, updateUser, deleteUser };
```

## License

MIT
