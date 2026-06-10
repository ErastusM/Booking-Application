// Set env vars before any module is loaded
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_32chars_xxxxxxxxxxx';
process.env.REFRESH_TOKEN_SECRET = 'test_refresh_secret_32chars_xxxxx';
process.env.JWT_EXPIRE = '7d';
process.env.REFRESH_TOKEN_EXPIRE = '30d';
process.env.CLIENT_URL = 'http://localhost:3001';
process.env.SERVER_URL = 'http://localhost:5000';
process.env.EMAIL_USER = 'test@example.com';
process.env.EMAIL_PASS = 'testpass';
process.env.GOOGLE_CLIENT_ID = 'test_google_client_id';
process.env.GOOGLE_CLIENT_SECRET = 'test_google_client_secret';
