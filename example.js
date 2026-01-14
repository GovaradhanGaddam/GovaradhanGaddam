/**
 * Example usage of the API Client utility
 * Run with: node example.js
 */

const { createApiClient, withLogging, ApiError } = require('./src/utils/api-client');

// Create a client pointing to a public test API
const api = createApiClient('https://jsonplaceholder.typicode.com', {
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
});

// Add logging to see requests/responses
withLogging(api);

async function main() {
  try {
    // GET request - fetch users
    console.log('\n--- Fetching users ---');
    const { data: users, status } = await api.get('/users');
    console.log(`Status: ${status}`);
    console.log(`Found ${users.length} users`);
    console.log('First user:', users[0].name);

    // GET with params
    console.log('\n--- Fetching posts with params ---');
    const { data: posts } = await api.get('/posts', {
      params: { userId: 1, _limit: 3 }
    });
    console.log(`Found ${posts.length} posts by user 1`);

    // POST request - create a new post
    console.log('\n--- Creating a new post ---');
    const { data: newPost } = await api.post('/posts', {
      title: 'My New Post',
      body: 'This is the post content',
      userId: 1
    });
    console.log('Created post with ID:', newPost.id);

    // PATCH request - update a post
    console.log('\n--- Updating a post ---');
    const { data: updated } = await api.patch('/posts/1', {
      title: 'Updated Title'
    });
    console.log('Updated title:', updated.title);

    // DELETE request
    console.log('\n--- Deleting a post ---');
    const { status: deleteStatus } = await api.delete('/posts/1');
    console.log('Delete status:', deleteStatus);

    console.log('\n--- All tests passed! ---\n');

  } catch (error) {
    if (error instanceof ApiError) {
      console.error('API Error:', error.message);
      console.error('Status:', error.statusCode);
      console.error('Response:', error.response);
    } else {
      console.error('Error:', error.message);
    }
  }
}

main();
