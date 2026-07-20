# Bookplus Booking Application - Setup Guide

## Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Node.js** (v14 or higher) - [Download](https://nodejs.org/)
- **MongoDB** (v5.0 or higher) - [Download](https://www.mongodb.com/try/download/community)
- **npm** or **yarn** (comes with Node.js)
- **Git** - [Download](https://git-scm.com/)

## Project Structure

```
Booking Application/
├── apps/api/                 # Backend API (Node.js + Express, npm-managed)
│   ├── src/
│   │   ├── models/        # Database models (User, Service, Appointment, …)
│   │   ├── routes/        # API routes
│   │   ├── controllers/   # Route handlers
│   │   ├── middleware/    # Custom middleware (auth, error handling)
│   │   └── utils/         # Helper functions
│   ├── package.json
│   ├── server.js          # Main server file
│   └── .env.example       # Environment variables template
│
├── apps/customer/          # Customer marketplace (Vite + React 18)
├── apps/business/          # Business management app (Vite + React 18)
├── packages/               # Shared pnpm-workspace packages
│   ├── design-tokens/     # tokens.css + tailwind preset
│   ├── api-client/        # TypeScript axios client + domain services
│   ├── ui/                # Shared React components
│   └── config/            # Shared tsconfig
│
└── README.md              # Project documentation
```

(The legacy CRA `client/` app is retired — the two Vite apps replaced it.)

## Installation Steps

### 1. Clone the Repository

```bash
git clone <repository-url>
cd "Booking Application"
```

### 2. Backend Setup

Navigate to the API directory:

```bash
cd apps/api
```

Install dependencies:

```bash
npm install
```

Create a `.env` file from the template:

```bash
# Windows PowerShell
Copy-Item .env.example -Destination .env

# Or manually create .env and add:
PORT=5050
MONGODB_URI=mongodb://localhost:27017/bookplus
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
NODE_ENV=development
JWT_EXPIRE=7d
REFRESH_TOKEN_SECRET=your_refresh_token_secret_change_this
REFRESH_TOKEN_EXPIRE=30d
```

### 3. MongoDB Setup

**Option A: Local MongoDB Installation**

Start MongoDB service:

```bash
# Windows (if installed as service)
net start MongoDB

# Or run mongod directly
mongod
```

**Option B: Docker (Recommended)**

If you have Docker installed:

```bash
docker run -d -p 27017:27017 --name bookplus-mongo mongo:6.0
```

### 4. Frontend Setup

Install dependencies from the **repo root** (pnpm workspace — covers both
apps plus the shared `packages/*`; `npm install` inside an app will fail
on the `workspace:*` dependencies):

```bash
pnpm install
```

Then create a `.env` in each app (`apps/customer`, `apps/business`):

```bash
# Windows PowerShell
Copy-Item .env.example -Destination .env

# Or manually create .env and add (API origin only — the api-client appends /api):
VITE_API_URL=http://localhost:5050
```

## Running the Application

### Development Mode

**Terminal 1 - Start Backend:**

```bash
cd apps/api
npm run dev
```

This will start the server on `http://localhost:5050` and watch for file changes.

**Terminal 2 - Start Frontends (from the repo root):**

```bash
pnpm customer:dev    # customer app on http://localhost:3002
pnpm business:dev    # business app on http://localhost:3003
```

(Ports 3000/3001/5000 are taken by other stacks on this machine.)

### Production Mode

**Build Frontends:**

```bash
pnpm --filter @bookplus/customer build
pnpm --filter @bookplus/business build
```

**Start Backend:**

```bash
cd apps/api
npm start
```

## Using Docker Compose (Recommended)

To run the entire application with Docker:

```bash
docker-compose up -d
```

This will:
- Start MongoDB on port 27017
- Start the backend server on port 5000
- Start the customer + business apps, fronted by nginx (plus certbot and the
  nightly backup service)

To stop:

```bash
docker-compose down
```

## Testing the API

Use tools like **Postman** or **Insomnia** to test the API endpoints.

### Sample API Calls

**Register a User:**

```bash
POST http://localhost:5050/api/auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "phone": "123-456-7890"
}
```

**Login:**

```bash
POST http://localhost:5050/api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "password123"
}
```

**Get All Services:**

```bash
GET http://localhost:5050/api/services
```

**Create an Appointment:**

```bash
POST http://localhost:5050/api/appointments
Authorization: Bearer <your_jwt_token>
Content-Type: application/json

{
  "serviceId": "service_id_here",
  "appointmentDate": "2024-02-15",
  "startTime": "10:00",
  "endTime": "10:30",
  "notes": "Please give me a fade"
}
```

## Features Implemented

### Authentication
- User registration and login
- JWT-based authentication
- Password hashing with bcryptjs
- Profile management

### Services Management
- View all available services
- Create services (admin only)
- Update services (admin only)
- Delete services (admin only)

### Appointments
- Book appointments with available services
- View personal appointments
- Update appointment details
- Cancel appointments

### Admin Dashboard Ready
- Foundation for admin dashboard
- Admin-only route protection
- Admin services management

## Database Schema

### User Model
- `_id`: MongoDB ObjectId
- `name`: String
- `email`: String (unique)
- `password`: String (hashed)
- `phone`: String
- `role`: String (customer/admin)
- `isActive`: Boolean
- `avatar`: String (optional)
- `timestamps`: Created and updated dates

### Service Model
- `_id`: MongoDB ObjectId
- `name`: String (unique)
- `description`: String
- `price`: Number
- `duration`: Number (minutes)
- `image`: String (optional)
- `isActive`: Boolean
- `createdBy`: User reference
- `timestamps`: Created and updated dates

### Appointment Model
- `_id`: MongoDB ObjectId
- `customer`: User reference
- `service`: Service reference
- `appointmentDate`: Date
- `startTime`: String (HH:MM format)
- `endTime`: String (HH:MM format)
- `status`: String (pending/confirmed/completed/cancelled)
- `notes`: String
- `totalPrice`: Number
- `cancellationReason`: String (optional)
- `timestamps`: Created and updated dates

## Available Endpoints

### Auth Routes
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/profile` - Get user profile
- `PUT /api/auth/profile` - Update user profile

### Service Routes
- `GET /api/services` - Get all services
- `GET /api/services/:id` - Get service by ID
- `POST /api/services` - Create service (admin only)
- `PUT /api/services/:id` - Update service (admin only)
- `DELETE /api/services/:id` - Delete service (admin only)

### Appointment Routes
- `GET /api/appointments` - Get all appointments (admin only)
- `GET /api/appointments/my-appointments` - Get user's appointments
- `POST /api/appointments` - Create appointment
- `PUT /api/appointments/:id` - Update appointment
- `POST /api/appointments/:id/cancel` - Cancel appointment

## Troubleshooting

### MongoDB Connection Error
- Ensure MongoDB is running: `mongod`
- Check MONGODB_URI in .env file
- Verify MongoDB is listening on port 27017

### Port Already in Use
- Change the PORT in apps/api/.env
- Change the app ports in the root package.json `customer:dev` / `business:dev` scripts

### Module Not Found
- Delete `node_modules` folder and `package-lock.json`
- Run `npm install` again

### CORS Error
- The backend already has CORS enabled
- Ensure VITE_API_URL points to the correct backend origin

## Next Steps

1. **Customize Branding**
   - Update tokens in `packages/design-tokens` (tokens.css + tailwind preset)
   - Change logo and images

2. **Add Payment Integration** *(currently an explicit product non-goal — see
   the README's "Intentionally omitted" section)*
   - Integrate Stripe or PayPal
   - Add payment status to appointments

3. **Implement Real-time Updates**
   - Add Socket.io for live appointment updates
   - Real-time availability notifications

(Admin dashboard, email notifications, reminders and the test suite already
exist — see README.)

## Support & Resources

- Node.js Documentation: https://nodejs.org/docs/
- Express.js: https://expressjs.com/
- React.js: https://react.dev/
- MongoDB: https://www.mongodb.com/docs/
- Tailwind CSS: https://tailwindcss.com/docs/

## License

MIT

## Contact

For support or questions, please reach out to the development team.
