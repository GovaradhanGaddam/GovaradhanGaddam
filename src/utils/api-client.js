/**
 * @fileoverview HTTP API Client Utility Module
 *
 * A robust, configurable HTTP client for making API requests with built-in support for:
 * - Request/response interceptors for middleware-like functionality
 * - Automatic retry with exponential backoff for transient failures
 * - Response caching with configurable TTL
 * - Request timeout handling
 * - Comprehensive error handling with detailed error objects
 *
 * @module utils/api-client
 * @version 1.0.0
 * @author GovaradhanGaddam
 * @license MIT
 *
 * @example <caption>Basic Usage</caption>
 * const { createApiClient } = require('./api-client');
 *
 * const client = createApiClient('https://api.example.com', {
 *   timeout: 5000,
 *   headers: { 'Content-Type': 'application/json' }
 * });
 *
 * // Make requests
 * const { data } = await client.get('/users');
 * const { data: newUser } = await client.post('/users', { name: 'John' });
 *
 * @example <caption>With Authentication</caption>
 * const { createApiClient, withAuth } = require('./api-client');
 *
 * const client = createApiClient('https://api.example.com');
 * withAuth(client, () => localStorage.getItem('token'));
 *
 * // All requests now include Authorization header
 * const { data } = await client.get('/protected-resource');
 */

'use strict';

/**
 * Default timeout for API requests in milliseconds.
 * Requests that exceed this duration will be aborted and throw an ApiError.
 * @constant {number}
 * @default 30000
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Default number of retry attempts for failed requests.
 * Only retryable errors (5xx, 408, 429, network errors) trigger retries.
 * @constant {number}
 * @default 3
 */
const DEFAULT_RETRIES = 3;

/**
 * @typedef {Object} ApiClientOptions
 * @property {number} [timeout=30000] - Request timeout in milliseconds
 * @property {number} [retries=3] - Number of retry attempts for failed requests
 * @property {Object.<string, string>} [headers={}] - Default headers for all requests
 * @property {boolean} [cacheEnabled=false] - Enable response caching for GET requests
 * @property {number} [cacheTTL=60000] - Cache time-to-live in milliseconds
 */

/**
 * @typedef {Object} RequestOptions
 * @property {Object.<string, (string|number|boolean|Array)>} [params] - URL query parameters
 * @property {Object} [body] - Request body (will be JSON stringified)
 * @property {Object.<string, string>} [headers] - Request-specific headers (merged with defaults)
 * @property {number} [timeout] - Request-specific timeout (overrides client default)
 * @property {boolean} [useCache=true] - Whether to use cache for this request (GET only)
 */

/**
 * @typedef {Object} RequestConfig
 * @property {string} method - HTTP method (GET, POST, PUT, PATCH, DELETE)
 * @property {string} url - Full request URL including query parameters
 * @property {Object.<string, string>} headers - Merged headers object
 * @property {string} [body] - JSON stringified request body
 * @property {number} timeout - Request timeout in milliseconds
 */

/**
 * @typedef {Object} ApiResponse
 * @property {*} data - Parsed response data (JSON object or text string)
 * @property {number} status - HTTP status code
 * @property {Headers} headers - Response headers object
 */

/**
 * @typedef {Function} RequestInterceptor
 * @param {RequestConfig} config - The request configuration object
 * @returns {Promise<RequestConfig>|RequestConfig} Modified request configuration
 * @description Function that receives and can modify the request configuration before sending
 */

/**
 * @typedef {Function} ResponseInterceptor
 * @param {ApiResponse} response - The response object
 * @returns {Promise<ApiResponse>|ApiResponse} Modified response object
 * @description Function that receives and can modify the response after receiving
 */

/**
 * Custom error class for API-related errors.
 * Provides detailed information about failed requests including status codes,
 * response bodies, and timestamps for debugging and logging purposes.
 *
 * @class ApiError
 * @extends Error
 *
 * @example <caption>Catching and handling ApiError</caption>
 * try {
 *   await client.get('/users/999');
 * } catch (error) {
 *   if (error instanceof ApiError) {
 *     console.log(`Request failed with status ${error.statusCode}`);
 *     console.log('Server response:', error.response);
 *     console.log('Error timestamp:', error.timestamp);
 *
 *     // Handle specific status codes
 *     if (error.statusCode === 404) {
 *       console.log('User not found');
 *     } else if (error.statusCode === 401) {
 *       console.log('Authentication required');
 *     }
 *   }
 * }
 *
 * @example <caption>Logging errors as JSON</caption>
 * try {
 *   await client.post('/users', invalidData);
 * } catch (error) {
 *   // Log structured error for monitoring systems
 *   logger.error(JSON.stringify(error.toJSON()));
 * }
 */
class ApiError extends Error {
  /**
   * Creates an ApiError instance.
   *
   * @param {string} message - Human-readable error message
   * @param {number|null} statusCode - HTTP status code (null for network errors)
   * @param {Object|string|null} response - Parsed response body from the server
   * @param {Error|null} [originalError=null] - Original error that caused this error
   *
   * @example
   * throw new ApiError('User not found', 404, { error: 'Not Found' });
   *
   * @example <caption>Wrapping a network error</caption>
   * throw new ApiError('Network request failed', null, null, originalNetworkError);
   */
  constructor(message, statusCode, response, originalError = null) {
    super(message);

    /**
     * Error name identifier
     * @type {string}
     */
    this.name = 'ApiError';

    /**
     * HTTP status code from the response.
     * Will be null for network errors or timeouts that don't produce a response.
     * @type {number|null}
     */
    this.statusCode = statusCode;

    /**
     * Parsed response body from the server.
     * Can be an object (for JSON responses), string (for text responses), or null.
     * @type {Object|string|null}
     */
    this.response = response;

    /**
     * Original error that was caught and wrapped.
     * Useful for debugging network issues or unexpected failures.
     * @type {Error|null}
     */
    this.originalError = originalError;

    /**
     * ISO 8601 timestamp of when the error occurred.
     * Useful for logging and debugging.
     * @type {string}
     */
    this.timestamp = new Date().toISOString();
  }

  /**
   * Converts the error to a JSON-serializable object.
   * Useful for logging, sending to error tracking services, or API responses.
   *
   * @returns {Object} JSON-serializable representation of the error
   * @returns {string} returns.name - Error name ('ApiError')
   * @returns {string} returns.message - Error message
   * @returns {number|null} returns.statusCode - HTTP status code
   * @returns {*} returns.response - Server response body
   * @returns {string} returns.timestamp - ISO 8601 timestamp
   *
   * @example
   * const error = new ApiError('Not found', 404, { id: 'missing' });
   * console.log(JSON.stringify(error.toJSON(), null, 2));
   * // Output:
   * // {
   * //   "name": "ApiError",
   * //   "message": "Not found",
   * //   "statusCode": 404,
   * //   "response": { "id": "missing" },
   * //   "timestamp": "2024-01-15T10:30:00.000Z"
   * // }
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      response: this.response,
      timestamp: this.timestamp,
    };
  }
}

/**
 * HTTP API Client class providing a robust interface for making HTTP requests.
 *
 * Features:
 * - Configurable timeouts and retry logic with exponential backoff
 * - Request and response interceptors for middleware functionality
 * - Built-in response caching for GET requests
 * - Automatic JSON parsing and content-type handling
 * - Comprehensive error handling with detailed error objects
 *
 * @class ApiClient
 *
 * @example <caption>Creating a client with custom configuration</caption>
 * const client = new ApiClient('https://api.example.com', {
 *   timeout: 10000,        // 10 second timeout
 *   retries: 5,            // Retry up to 5 times
 *   cacheEnabled: true,    // Enable response caching
 *   cacheTTL: 300000,      // Cache for 5 minutes
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'X-API-Version': '2.0'
 *   }
 * });
 *
 * @example <caption>Using interceptors for authentication</caption>
 * const client = new ApiClient('https://api.example.com');
 *
 * // Add authentication header to all requests
 * client.addRequestInterceptor(async (config) => {
 *   const token = await getAuthToken();
 *   config.headers['Authorization'] = `Bearer ${token}`;
 *   return config;
 * });
 *
 * // Transform all responses
 * client.addResponseInterceptor((response) => {
 *   return { ...response, receivedAt: Date.now() };
 * });
 */
class ApiClient {
  /**
   * Creates a new ApiClient instance.
   *
   * @param {string} baseUrl - Base URL for all requests (trailing slash removed automatically)
   * @param {ApiClientOptions} [options={}] - Configuration options
   *
   * @example <caption>Basic instantiation</caption>
   * const client = new ApiClient('https://api.example.com');
   *
   * @example <caption>With full configuration</caption>
   * const client = new ApiClient('https://api.example.com/', {
   *   timeout: 15000,
   *   retries: 3,
   *   cacheEnabled: true,
   *   cacheTTL: 60000,
   *   headers: {
   *     'Accept': 'application/json',
   *     'X-Client-Version': '1.0.0'
   *   }
   * });
   */
  constructor(baseUrl, options = {}) {
    /**
     * Base URL for all requests (trailing slash stripped)
     * @type {string}
     * @private
     */
    this.baseUrl = baseUrl.replace(/\/$/, '');

    /**
     * Request timeout in milliseconds
     * @type {number}
     */
    this.timeout = options.timeout || DEFAULT_TIMEOUT;

    /**
     * Maximum number of retry attempts
     * @type {number}
     */
    this.retries = options.retries || DEFAULT_RETRIES;

    /**
     * Default headers applied to all requests
     * @type {Object.<string, string>}
     */
    this.headers = options.headers || {};

    /**
     * Registered interceptors for request/response modification
     * @type {{request: RequestInterceptor[], response: ResponseInterceptor[]}}
     * @private
     */
    this.interceptors = {
      request: [],
      response: [],
    };

    /**
     * Internal cache storage for GET responses
     * @type {Map<string, {data: ApiResponse, timestamp: number}>}
     * @private
     */
    this.cache = new Map();

    /**
     * Whether caching is enabled for GET requests
     * @type {boolean}
     */
    this.cacheEnabled = options.cacheEnabled || false;

    /**
     * Cache entry time-to-live in milliseconds
     * @type {number}
     */
    this.cacheTTL = options.cacheTTL || 60000;
  }

  /**
   * Registers a request interceptor that runs before each request.
   * Interceptors are executed in the order they were added and can modify
   * the request configuration (URL, headers, body, etc.).
   *
   * @param {RequestInterceptor} interceptor - Function to process request config
   * @returns {number} Index of the interceptor (used for removal)
   *
   * @example <caption>Adding authentication</caption>
   * const authIndex = client.addRequestInterceptor(async (config) => {
   *   const token = await refreshTokenIfNeeded();
   *   config.headers['Authorization'] = `Bearer ${token}`;
   *   return config;
   * });
   *
   * @example <caption>Adding request logging</caption>
   * client.addRequestInterceptor((config) => {
   *   console.log(`Making ${config.method} request to ${config.url}`);
   *   return config;
   * });
   *
   * @example <caption>Modifying request body</caption>
   * client.addRequestInterceptor((config) => {
   *   if (config.body) {
   *     const body = JSON.parse(config.body);
   *     body.timestamp = Date.now();
   *     config.body = JSON.stringify(body);
   *   }
   *   return config;
   * });
   */
  addRequestInterceptor(interceptor) {
    this.interceptors.request.push(interceptor);
    return this.interceptors.request.length - 1;
  }

  /**
   * Registers a response interceptor that runs after each successful response.
   * Interceptors are executed in the order they were added and can modify
   * or transform the response data.
   *
   * @param {ResponseInterceptor} interceptor - Function to process response
   * @returns {number} Index of the interceptor (used for removal)
   *
   * @example <caption>Extracting data from wrapper</caption>
   * client.addResponseInterceptor((response) => {
   *   // API returns { success: true, data: {...}, meta: {...} }
   *   // Extract just the data portion
   *   if (response.data && response.data.data) {
   *     response.data = response.data.data;
   *   }
   *   return response;
   * });
   *
   * @example <caption>Adding metadata</caption>
   * client.addResponseInterceptor((response) => {
   *   return {
   *     ...response,
   *     receivedAt: Date.now(),
   *     cached: false
   *   };
   * });
   *
   * @example <caption>Response validation</caption>
   * client.addResponseInterceptor((response) => {
   *   if (!response.data) {
   *     throw new Error('Invalid response: missing data');
   *   }
   *   return response;
   * });
   */
  addResponseInterceptor(interceptor) {
    this.interceptors.response.push(interceptor);
    return this.interceptors.response.length - 1;
  }

  /**
   * Removes a previously registered request interceptor.
   *
   * @param {number} index - Index returned by addRequestInterceptor
   * @returns {boolean} True if removal was successful, false otherwise
   *
   * @example
   * const index = client.addRequestInterceptor(myInterceptor);
   * // Later...
   * const removed = client.removeRequestInterceptor(index);
   * console.log(removed); // true
   */
  removeRequestInterceptor(index) {
    if (index >= 0 && index < this.interceptors.request.length) {
      this.interceptors.request.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Removes a previously registered response interceptor.
   *
   * @param {number} index - Index returned by addResponseInterceptor
   * @returns {boolean} True if removal was successful, false otherwise
   *
   * @example
   * const index = client.addResponseInterceptor(myInterceptor);
   * // Later...
   * const removed = client.removeResponseInterceptor(index);
   * console.log(removed); // true
   */
  removeResponseInterceptor(index) {
    if (index >= 0 && index < this.interceptors.response.length) {
      this.interceptors.response.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Applies all registered request interceptors to the config sequentially.
   *
   * @param {RequestConfig} config - Initial request configuration
   * @returns {Promise<RequestConfig>} Modified request configuration
   * @private
   */
  async _applyRequestInterceptors(config) {
    let currentConfig = { ...config };
    for (const interceptor of this.interceptors.request) {
      currentConfig = await interceptor(currentConfig);
    }
    return currentConfig;
  }

  /**
   * Applies all registered response interceptors to the response sequentially.
   *
   * @param {ApiResponse} response - Initial response object
   * @returns {Promise<ApiResponse>} Modified response object
   * @private
   */
  async _applyResponseInterceptors(response) {
    let currentResponse = response;
    for (const interceptor of this.interceptors.response) {
      currentResponse = await interceptor(currentResponse);
    }
    return currentResponse;
  }

  /**
   * Constructs the full URL with query parameters.
   * Handles array parameters by appending multiple values with the same key.
   *
   * @param {string} endpoint - API endpoint path (e.g., '/users')
   * @param {Object.<string, (string|number|boolean|Array)>} [params={}] - Query parameters
   * @returns {string} Full URL with query string
   * @private
   *
   * @example
   * // baseUrl: 'https://api.example.com'
   * _buildUrl('/users', { page: 1, limit: 10 })
   * // Returns: 'https://api.example.com/users?page=1&limit=10'
   *
   * @example <caption>Array parameters</caption>
   * _buildUrl('/search', { tags: ['js', 'node'] })
   * // Returns: 'https://api.example.com/search?tags=js&tags=node'
   */
  _buildUrl(endpoint, params = {}) {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          value.forEach(v => url.searchParams.append(key, v));
        } else {
          url.searchParams.append(key, value);
        }
      }
    });
    return url.toString();
  }

  /**
   * Generates a unique cache key for a request.
   *
   * @param {string} method - HTTP method
   * @param {string} url - Full request URL
   * @param {Object} [body] - Request body
   * @returns {string} Cache key
   * @private
   */
  _getCacheKey(method, url, body) {
    return `${method}:${url}:${JSON.stringify(body || '')}`;
  }

  /**
   * Retrieves a cached response if available and not expired.
   *
   * @param {string} key - Cache key
   * @returns {ApiResponse|null} Cached response or null if not found/expired
   * @private
   */
  _getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }

  /**
   * Stores a response in the cache.
   *
   * @param {string} key - Cache key
   * @param {ApiResponse} data - Response to cache
   * @private
   */
  _setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Clears all cached responses.
   * Call this when you need to invalidate the entire cache, such as after
   * a logout or when you know data has changed server-side.
   *
   * @returns {void}
   *
   * @example <caption>Clear cache on logout</caption>
   * function logout() {
   *   localStorage.removeItem('token');
   *   apiClient.clearCache();
   *   router.push('/login');
   * }
   *
   * @example <caption>Clear cache after data mutation</caption>
   * await client.post('/users', newUser);
   * client.clearCache(); // Ensure fresh data on next GET
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Executes a function with automatic retry on failure.
   * Uses exponential backoff: 1s, 2s, 4s, 8s, etc.
   *
   * @param {Function} fn - Async function to execute
   * @param {number} [retries=this.retries] - Maximum retry attempts
   * @returns {Promise<*>} Result of the function
   * @throws {Error} Last error if all retries fail
   * @private
   */
  async _executeWithRetry(fn, retries = this.retries) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < retries && this._isRetryable(error)) {
          await this._delay(Math.pow(2, attempt) * 1000);
        } else {
          throw error;
        }
      }
    }
    throw lastError;
  }

  /**
   * Determines if an error should trigger a retry.
   * Retryable errors include:
   * - 408 Request Timeout
   * - 429 Too Many Requests
   * - 500 Internal Server Error
   * - 502 Bad Gateway
   * - 503 Service Unavailable
   * - 504 Gateway Timeout
   * - Network errors (TypeError, 'network' in message)
   *
   * @param {Error} error - Error to evaluate
   * @returns {boolean} True if the error is retryable
   * @private
   */
  _isRetryable(error) {
    if (error instanceof ApiError) {
      return [408, 429, 500, 502, 503, 504].includes(error.statusCode);
    }
    return error.name === 'TypeError' || error.message.includes('network');
  }

  /**
   * Creates a promise that resolves after specified milliseconds.
   *
   * @param {number} ms - Delay in milliseconds
   * @returns {Promise<void>} Promise that resolves after delay
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Makes an HTTP request with full configuration options.
   * This is the core method that powers all HTTP verb shortcuts (get, post, etc.).
   *
   * Features:
   * - Applies request interceptors before sending
   * - Applies response interceptors after receiving
   * - Automatic retry with exponential backoff for transient failures
   * - Response caching for GET requests (when enabled)
   * - Automatic JSON parsing based on content-type
   * - Request timeout with AbortController
   *
   * @param {string} method - HTTP method (GET, POST, PUT, PATCH, DELETE)
   * @param {string} endpoint - API endpoint path (e.g., '/users', '/posts/123')
   * @param {RequestOptions} [options={}] - Request configuration options
   * @returns {Promise<ApiResponse>} Response object with data, status, and headers
   * @throws {ApiError} On HTTP errors (4xx, 5xx), timeouts, or network failures
   *
   * @example <caption>GET request with query parameters</caption>
   * const response = await client.request('GET', '/users', {
   *   params: { page: 1, limit: 20, sort: 'name' }
   * });
   * console.log(response.data); // Array of users
   * console.log(response.status); // 200
   *
   * @example <caption>POST request with body</caption>
   * const response = await client.request('POST', '/users', {
   *   body: { name: 'John', email: 'john@example.com' },
   *   headers: { 'X-Request-ID': 'abc123' }
   * });
   *
   * @example <caption>Request with custom timeout</caption>
   * const response = await client.request('GET', '/slow-endpoint', {
   *   timeout: 60000 // 60 second timeout for this request only
   * });
   *
   * @example <caption>Bypassing cache</caption>
   * const response = await client.request('GET', '/users', {
   *   useCache: false // Force fresh data
   * });
   */
  async request(method, endpoint, options = {}) {
    const { params, body, headers, timeout, useCache } = options;
    const url = this._buildUrl(endpoint, params);
    const cacheKey = this._getCacheKey(method, url, body);

    // Check cache for GET requests
    if (this.cacheEnabled && useCache !== false && method === 'GET') {
      const cached = this._getFromCache(cacheKey);
      if (cached) return cached;
    }

    // Build request configuration
    let config = {
      method,
      url,
      headers: { ...this.headers, ...headers },
      body: body ? JSON.stringify(body) : undefined,
      timeout: timeout || this.timeout,
    };

    // Apply request interceptors
    config = await this._applyRequestInterceptors(config);

    // Define the request execution function for retry logic
    const executeRequest = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeout);

      try {
        const response = await fetch(config.url, {
          method: config.method,
          headers: config.headers,
          body: config.body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle error responses
        if (!response.ok) {
          const errorBody = await response.text();
          let parsedError;
          try {
            parsedError = JSON.parse(errorBody);
          } catch {
            parsedError = errorBody;
          }
          throw new ApiError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            parsedError
          );
        }

        // Parse response based on content type
        const contentType = response.headers.get('content-type');
        let data;
        if (contentType && contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        return { data, status: response.status, headers: response.headers };
      } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          throw new ApiError('Request timeout', 408, null, error);
        }
        if (error instanceof ApiError) throw error;
        throw new ApiError(error.message, null, null, error);
      }
    };

    // Execute with retry logic
    let response = await this._executeWithRetry(executeRequest);

    // Apply response interceptors
    response = await this._applyResponseInterceptors(response);

    // Cache successful GET responses
    if (this.cacheEnabled && useCache !== false && method === 'GET') {
      this._setCache(cacheKey, response);
    }

    return response;
  }

  /**
   * Makes a GET request to retrieve data from the server.
   *
   * @param {string} endpoint - API endpoint path
   * @param {RequestOptions} [options={}] - Request options (params, headers, timeout, useCache)
   * @returns {Promise<ApiResponse>} Response with data, status, and headers
   * @throws {ApiError} On request failure
   *
   * @example <caption>Simple GET request</caption>
   * const { data } = await client.get('/users');
   * console.log(data); // Array of users
   *
   * @example <caption>GET with query parameters</caption>
   * const { data } = await client.get('/users', {
   *   params: {
   *     page: 2,
   *     limit: 50,
   *     status: 'active',
   *     roles: ['admin', 'editor'] // Array params
   *   }
   * });
   *
   * @example <caption>GET single resource</caption>
   * const { data: user } = await client.get('/users/123');
   * console.log(user.name);
   *
   * @example <caption>GET with custom headers</caption>
   * const { data } = await client.get('/protected', {
   *   headers: { 'X-Custom-Header': 'value' }
   * });
   */
  get(endpoint, options = {}) {
    return this.request('GET', endpoint, options);
  }

  /**
   * Makes a POST request to create a new resource.
   *
   * @param {string} endpoint - API endpoint path
   * @param {Object} body - Request body (will be JSON stringified)
   * @param {RequestOptions} [options={}] - Additional request options
   * @returns {Promise<ApiResponse>} Response with created resource data
   * @throws {ApiError} On request failure
   *
   * @example <caption>Create a new user</caption>
   * const { data: newUser } = await client.post('/users', {
   *   name: 'John Doe',
   *   email: 'john@example.com',
   *   role: 'user'
   * });
   * console.log(newUser.id); // Newly created user ID
   *
   * @example <caption>POST with nested data</caption>
   * const { data } = await client.post('/orders', {
   *   customer: { id: 123 },
   *   items: [
   *     { productId: 1, quantity: 2 },
   *     { productId: 5, quantity: 1 }
   *   ],
   *   shipping: { method: 'express' }
   * });
   *
   * @example <caption>POST with custom headers</caption>
   * const { data } = await client.post('/webhook', payload, {
   *   headers: { 'X-Webhook-Secret': 'abc123' }
   * });
   */
  post(endpoint, body, options = {}) {
    return this.request('POST', endpoint, { ...options, body });
  }

  /**
   * Makes a PUT request to fully replace a resource.
   *
   * @param {string} endpoint - API endpoint path (typically includes resource ID)
   * @param {Object} body - Complete resource data to replace existing
   * @param {RequestOptions} [options={}] - Additional request options
   * @returns {Promise<ApiResponse>} Response with updated resource data
   * @throws {ApiError} On request failure
   *
   * @example <caption>Update entire user object</caption>
   * const { data } = await client.put('/users/123', {
   *   name: 'John Smith',
   *   email: 'johnsmith@example.com',
   *   role: 'admin',
   *   active: true
   * });
   *
   * @example <caption>Replace configuration</caption>
   * await client.put('/settings/app', {
   *   theme: 'dark',
   *   notifications: true,
   *   language: 'en'
   * });
   */
  put(endpoint, body, options = {}) {
    return this.request('PUT', endpoint, { ...options, body });
  }

  /**
   * Makes a PATCH request to partially update a resource.
   *
   * @param {string} endpoint - API endpoint path (typically includes resource ID)
   * @param {Object} body - Partial resource data to update
   * @param {RequestOptions} [options={}] - Additional request options
   * @returns {Promise<ApiResponse>} Response with updated resource data
   * @throws {ApiError} On request failure
   *
   * @example <caption>Update user email only</caption>
   * const { data } = await client.patch('/users/123', {
   *   email: 'newemail@example.com'
   * });
   *
   * @example <caption>Toggle feature flag</caption>
   * await client.patch('/features/dark-mode', {
   *   enabled: true
   * });
   *
   * @example <caption>Update nested property</caption>
   * await client.patch('/users/123/preferences', {
   *   'notifications.email': false
   * });
   */
  patch(endpoint, body, options = {}) {
    return this.request('PATCH', endpoint, { ...options, body });
  }

  /**
   * Makes a DELETE request to remove a resource.
   *
   * @param {string} endpoint - API endpoint path (typically includes resource ID)
   * @param {RequestOptions} [options={}] - Request options (params, headers)
   * @returns {Promise<ApiResponse>} Response (often empty or confirmation)
   * @throws {ApiError} On request failure
   *
   * @example <caption>Delete a user</caption>
   * await client.delete('/users/123');
   *
   * @example <caption>Delete with confirmation</caption>
   * const { status } = await client.delete('/posts/456');
   * if (status === 204) {
   *   console.log('Post deleted successfully');
   * }
   *
   * @example <caption>Bulk delete with params</caption>
   * await client.delete('/notifications', {
   *   params: { ids: [1, 2, 3, 4, 5] }
   * });
   */
  delete(endpoint, options = {}) {
    return this.request('DELETE', endpoint, options);
  }
}

/**
 * Factory function to create a new ApiClient instance.
 * Provides a more functional approach to client creation.
 *
 * @param {string} baseUrl - Base URL for all requests
 * @param {ApiClientOptions} [options={}] - Client configuration options
 * @returns {ApiClient} Configured API client instance
 *
 * @example <caption>Create production client</caption>
 * const api = createApiClient('https://api.production.com', {
 *   timeout: 30000,
 *   retries: 3,
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Accept': 'application/json'
 *   }
 * });
 *
 * @example <caption>Create client with caching</caption>
 * const cachedApi = createApiClient('https://api.example.com', {
 *   cacheEnabled: true,
 *   cacheTTL: 300000 // 5 minutes
 * });
 */
function createApiClient(baseUrl, options) {
  return new ApiClient(baseUrl, options);
}

/**
 * Higher-order function that adds authentication to an API client.
 * Automatically injects Bearer token into all requests.
 *
 * @param {ApiClient} client - API client instance to enhance
 * @param {string|Function} tokenProvider - Static token string or async function returning token
 * @returns {ApiClient} The same client instance (for chaining)
 *
 * @example <caption>Static token</caption>
 * const client = createApiClient('https://api.example.com');
 * withAuth(client, 'my-static-api-key');
 *
 * @example <caption>Dynamic token from storage</caption>
 * const client = createApiClient('https://api.example.com');
 * withAuth(client, () => localStorage.getItem('authToken'));
 *
 * @example <caption>Async token refresh</caption>
 * const client = createApiClient('https://api.example.com');
 * withAuth(client, async () => {
 *   const token = getStoredToken();
 *   if (isTokenExpired(token)) {
 *     const newToken = await refreshToken();
 *     storeToken(newToken);
 *     return newToken;
 *   }
 *   return token;
 * });
 *
 * @example <caption>Chaining with other enhancers</caption>
 * const client = createApiClient('https://api.example.com');
 * withAuth(withLogging(client, console), getToken);
 */
function withAuth(client, tokenProvider) {
  client.addRequestInterceptor(async (config) => {
    const token = typeof tokenProvider === 'function'
      ? await tokenProvider()
      : tokenProvider;
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${token}`,
    };
    return config;
  });
  return client;
}

/**
 * Higher-order function that adds request/response logging to an API client.
 * Useful for debugging, monitoring, or audit logging.
 *
 * @param {ApiClient} client - API client instance to enhance
 * @param {Object} [logger=console] - Logger object with log method
 * @param {Function} logger.log - Logging function
 * @returns {ApiClient} The same client instance (for chaining)
 *
 * @example <caption>Using default console logger</caption>
 * const client = createApiClient('https://api.example.com');
 * withLogging(client);
 * // Logs: [API Request] GET https://api.example.com/users
 * // Logs: [API Response] Status: 200
 *
 * @example <caption>Custom logger</caption>
 * const client = createApiClient('https://api.example.com');
 * withLogging(client, {
 *   log: (message) => winston.info(message)
 * });
 *
 * @example <caption>Debug-only logging</caption>
 * const client = createApiClient('https://api.example.com');
 * if (process.env.NODE_ENV === 'development') {
 *   withLogging(client);
 * }
 */
function withLogging(client, logger = console) {
  client.addRequestInterceptor(async (config) => {
    logger.log(`[API Request] ${config.method} ${config.url}`);
    return config;
  });
  client.addResponseInterceptor(async (response) => {
    logger.log(`[API Response] Status: ${response.status}`);
    return response;
  });
  return client;
}

module.exports = {
  ApiClient,
  ApiError,
  createApiClient,
  withAuth,
  withLogging,
  DEFAULT_TIMEOUT,
  DEFAULT_RETRIES,
};
