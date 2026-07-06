# 🏗️ Bookplus Booking Application - Architecture Guide

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER DEVICES (Browser)                      │
│                    http://localhost:3000                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    REACT.JS FRONTEND
                             │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
    ┌────▼──┐          ┌─────▼────┐        ┌────▼─────┐
    │Pages  │          │Components│        │Services  │
    ├───────┤          ├──────────┤        ├──────────┤
    │Home   │          │Navbar    │        │AuthAPI   │
    │Login  │          │Navbar    │        │ServAPI   │
    │Register          │Protected │        │AptAPI    │
    │Services│         │Route     │        └──────────┘
    │Book   │          └──────────┘
    │MyApts │
    └───────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                             │
                   AXIOS HTTP CLIENT
                   (With JWT Interceptors)
                             │
      ┌──────────────────────┴──────────────────────┐
      │    http://localhost:5000/api               │
      │                                             │
      │     EXPRESS.JS BACKEND SERVER              │
      │                                             │
      ├──────────────────────────────────────────┤
      │                                             │
      │  ROUTES LAYER                             │
      │  ├─ /api/auth/*                          │
      │  ├─ /api/services/*                      │
      │  └─ /api/appointments/*                  │
      │                                             │
      ├──────────────────────────────────────────┤
      │                                             │
      │  MIDDLEWARE LAYER                         │
      │  ├─ authMiddleware (JWT Verification)   │
      │  ├─ authorizeMiddleware (RBAC)         │
      │  ├─ errorHandler                        │
      │  └─ CORS, Helmet, Body Parser          │
      │                                             │
      ├──────────────────────────────────────────┤
      │                                             │
      │  CONTROLLERS LAYER                        │
      │  ├─ authController                       │
      │  ├─ serviceController                    │
      │  └─ appointmentController                │
      │                                             │
      ├──────────────────────────────────────────┤
      │                                             │
      │  MODELS LAYER                             │
      │  (Mongoose ODM)                          │
      │  ├─ User Schema                          │
      │  ├─ Service Schema                       │
      │  ├─ Appointment Schema                   │
      │  └─ TimeSlot Schema                      │
      │                                             │
      └──────────────────────────────────────────┘
                             │
          ┌──────────────────┴──────────────────┐
          │                                      │
      ┌───▼────────┐                   ┌───────▼──┐
      │  MONGODB   │                   │ UTILITIES│
      │            │                   │          │
      │ Database:  │                   │helpers.js│
      │'bookplus'│                   │database. │
      │            │                   │js        │
      │Collections:│                   │validators│
      │- users     │                   └──────────┘
      │- services  │
      │- appts     │
      │- timeslots │
      └────────────┘
```

---

## Data Flow Diagrams

### 1. User Registration & Authentication Flow

```
┌─────────┐
│  User   │
│  Input  │
└────┬────┘
     │ Registration Form
     ▼
┌──────────────────────┐
│  Frontend Validation │
│  (React Component)   │
└────┬────────────────┘
     │ Valid Data
     ▼
┌──────────────────────────────────────┐
│ POST /api/auth/register              │
│ (axios.post with data)               │
└────┬───────────────────────────────┐
     │                               │
     ▼                               │ HTTP Request
┌─────────────────────────────────┐ │
│  Backend Route Handler          │◄┘
│  authRoutes.js                  │
└────┬────────────────────────────┘
     │
     ▼
┌────────────────────────────────────┐
│  authController.register()         │
│  1. Validate input                 │
│  2. Hash password (bcryptjs)       │
│  3. Create user in DB              │
│  4. Generate JWT token            │
└────┬───────────────────────────────┘
     │
     ▼
┌────────────────────────────────────┐
│  User Model (Mongoose)             │
│  Save to MongoDB                   │
└────┬───────────────────────────────┘
     │
     ▼
┌────────────────────────────────────┐
│  MongoDB Response                  │
│  {_id, name, email, ...}           │
└────┬───────────────────────────────┘
     │
     ▼
┌────────────────────────────────────┐
│  Generate Tokens                   │
│  - JWT Token (expires in 7 days)  │
│  - Refresh Token                  │
└────┬───────────────────────────────┘
     │ JSON Response with tokens
     ▼
┌──────────────────────────────────┐
│  Frontend receives response      │
│  - Store token in localStorage  │
│  - Update AuthContext           │
│  - Redirect to home page        │
└──────────────────────────────────┘
```

### 2. Appointment Booking Flow

```
┌──────────────────┐
│  Customer Login  │
│   ✓ Token Set    │
└────┬─────────────┘
     │
     ▼
┌─────────────────────────────────┐
│  Browse Services                │
│  GET /api/services              │
│  Display available services     │
└────┬────────────────────────────┘
     │
     ▼
┌──────────────────────────────┐
│  Select Service & Date/Time  │
│  Fill Booking Form           │
└────┬─────────────────────────┘
     │
     ▼
┌────────────────────────────────────┐
│  POST /api/appointments            │
│  With JWT Token in Authorization   │
│  Header (Bearer token)             │
└────┬───────────────────────────────┘
     │
     ▼
┌───────────────────────────────────┐
│  Backend Middleware               │
│  1. Verify JWT token             │
│  2. Extract user ID from token   │
│  3. Authorize access             │
└────┬──────────────────────────────┘
     │
     ▼
┌───────────────────────────────────┐
│  appointmentController.create()    │
│  1. Validate input                │
│  2. Check if service exists       │
│  3. Check for time conflicts      │
│  4. Calculate price               │
└────┬──────────────────────────────┘
     │
     ▼
┌───────────────────────────────────┐
│  Appointment Model (Mongoose)      │
│  Save appointment to DB            │
│  Status: 'pending'                │
└────┬──────────────────────────────┘
     │
     ▼
┌───────────────────────────────────┐
│  Return Success Response          │
│  {_id, status, date, time, ...}   │
└────┬──────────────────────────────┘
     │
     ▼
┌──────────────────────────────────┐
│  Frontend Updates                │
│  - Show confirmation message     │
│  - Add to appointments list      │
│  - Update context state          │
│  - Redirect to my appointments   │
└──────────────────────────────────┘
```

### 3. Admin Authentication Flow

```
┌──────────────────────┐
│  Admin User Login    │
│  (customer account)  │
└────┬─────────────────┘
     │
     ▼
┌──────────────────────────┐
│ Verify admin role in:    │
│ 1. JWT token payload     │
│ 2. User document in DB   │
└────┬─────────────────────┘
     │ role: 'admin'
     ▼
┌──────────────────────────┐
│ Show admin features:     │
│ - Dashboard link         │
│ - Service management     │
│ - Appointment list       │
└──────────────────────────┘
```

---

## Component Hierarchy

### Frontend Component Tree

```
App.js
├── AuthProvider (Context)
│   ├── Navbar
│   │   ├── Logo
│   │   ├── Navigation Links
│   │   │   ├── Home
│   │   │   ├── Services
│   │   │   ├── My Appointments (if logged in)
│   │   │   ├── Dashboard (if admin)
│   │   │   └── Login/Register (if not logged in)
│   │   └── Logout Button (if logged in)
│   │
│   └── Routes
│       ├── / → Home Page
│       ├── /login → Login Component
│       ├── /register → Register Component
│       ├── /services → Services Component
│       ├── /book-appointment → ProtectedRoute + BookAppointment
│       └── /appointments → ProtectedRoute + MyAppointments
```

---

## Database Schema Relationships

```
┌─────────────────┐
│      USER       │
│  (customers &   │
│    admins)      │
├─────────────────┤
│ _id             │
│ name            │
│ email (unique)  │
│ password        │
│ phone           │
│ role ──────┐    │
│ isActive   │    │
│ avatar     │    │
│ timestamps │    │
└─────────────────┘
        ▲          
        │ createdBy
        │ customer
        │
    ┌───┴──────────────┬────────────────┐
    │                  │                │
┌───▼───────┐  ┌────────▼──────┐  ┌──────▼──────┐
│  SERVICE  │  │ APPOINTMENT   │  │ TIMESLOT    │
├───────────┤  ├───────────────┤  ├─────────────┤
│ _id       │  │ _id           │  │ _id         │
│ name      │  │ customer_id ──┼──┼─→ USER      │
│ price     │◄─┼─ service_id   │  │ date        │
│ duration  │  │ appointDate   │  │ startTime   │
│ image     │  │ startTime     │  │ endTime     │
│ createdBy │  │ endTime       │  │ isAvailable │
│ isActive  │  │ status        │  │ appointment │
│ timestamps│  │ notes         │  │ timestamps  │
└───────────┘  │ totalPrice    │  └─────────────┘
               │ cancellation  │
               │ Reason        │
               │ timestamps    │
               └───────────────┘
```

---

## Authentication & Authorization Flow

```
REQUEST ARRIVES
     │
     ▼
┌────────────────────────────────────┐
│  Check Route Protection            │
│  (Public vs Protected)             │
└────┬─────────────────────────────┐
     │                              │
     ▼ Public                 Protected ▼
┌──────────────┐          ┌──────────────────────┐
│ Allow Access │          │ Extract JWT Token    │
│ (no token    │          │ From Authorization   │
│  needed)     │          │ Header               │
└──────────────┘          └────┬─────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Verify Token        │
                    │ - Valid?            │
                    │ - Expired?          │
                    │ - Correct secret?   │
                    └────┬────────┬──────┘
                    YES  │        │ NO
     ┌──────────────────┘        └────────────┐
     │                                        │
     ▼                                        ▼
┌──────────────────────┐         ┌────────────────────┐
│ Decode Token         │         │ Return 401         │
│ Get User ID & Role   │         │ Unauthorized       │
└────┬─────────────────┘         └────────────────────┘
     │
     ▼
┌──────────────────────────────────┐
│ Check Role Authorization (RBAC)  │
│ Does user's role match route?    │
└────┬─────────────────────────────┘
     │
  YES│                            NO│
     ▼                              ▼
┌──────────────────┐      ┌─────────────────────┐
│ Allow Access     │      │ Return 403          │
│ Continue to      │      │ Forbidden           │
│ Controller       │      │ (Insufficient       │
│                  │      │  permissions)       │
└──────────────────┘      └─────────────────────┘
```

---

## Project Deployment Architecture

```
┌─────────────────────────────────────────────────────────┐
│              DOCKER CONTAINER ORCHESTRATION             │
│                  (docker-compose.yml)                   │
└────┬────────────────┬──────────────┬────────────────────┘
     │                │              │
┌────▼──────┐  ┌─────▼──────┐  ┌──────▼──────┐
│  MONGODB   │  │  BACKEND   │  │  FRONTEND   │
│  Container │  │  Container │  │  Container  │
├────────────┤  ├────────────┤  ├─────────────┤
│ Port: 27017│  │ Port: 5000 │  │ Port: 3000  │
│ Image: mongo│  │ Image: Node│  │ Image: Node │
│ Volume:    │  │ Volume:    │  │ Volume:     │
│ mongo_data │  │ ./server   │  │ ./client    │
└────────────┘  └────────────┘  └─────────────┘
     ▲               ▲                  ▲
     │               │                  │
     └───────────────┴──────────────────┘
      Network: "bookplus-network"
      All containers can communicate
      using service names as hostnames
```

---

## Folder Structure Tree

```
Booking Application/
│
├── 📁 apps/api/                     # Backend application
│   ├── 📁 src/
│   │   ├── 📁 models/            # MongoDB schemas
│   │   │   ├── User.js
│   │   │   ├── Service.js
│   │   │   ├── Appointment.js
│   │   │   └── TimeSlot.js
│   │   │
│   │   ├── 📁 routes/            # API routes
│   │   │   ├── authRoutes.js
│   │   │   ├── serviceRoutes.js
│   │   │   └── appointmentRoutes.js
│   │   │
│   │   ├── 📁 controllers/       # Route handlers
│   │   │   ├── authController.js
│   │   │   ├── serviceController.js
│   │   │   └── appointmentController.js
│   │   │
│   │   ├── 📁 middleware/        # Middleware functions
│   │   │   ├── auth.js          # JWT verification
│   │   │   └── errorHandler.js  # Error handling
│   │   │
│   │   └── 📁 utils/            # Utility functions
│   │       ├── database.js      # MongoDB connection
│   │       └── helpers.js       # Helper functions
│   │
│   ├── server.js                # Main entry point
│   ├── package.json             # Dependencies
│   ├── .env.example             # Environment template
│   ├── .gitignore
│   └── Dockerfile
│
├── 📁 client/                     # Frontend application
│   ├── 📁 public/
│   │   └── index.html            # HTML template
│   │
│   ├── 📁 src/
│   │   ├── 📁 pages/            # Full page components
│   │   │   ├── Home.js
│   │   │   ├── Login.js
│   │   │   ├── Register.js
│   │   │   ├── Services.js
│   │   │   ├── BookAppointment.js
│   │   │   └── MyAppointments.js
│   │   │
│   │   ├── 📁 components/       # Reusable components
│   │   │   ├── Navbar.js
│   │   │   └── ProtectedRoute.js
│   │   │
│   │   ├── 📁 services/         # API calls
│   │   │   ├── api.js           # Axios instance
│   │   │   └── index.js         # Service functions
│   │   │
│   │   ├── 📁 context/          # State management
│   │   │   └── AuthContext.js
│   │   │
│   │   ├── 📁 hooks/            # Custom hooks
│   │   │   └── useAuth.js
│   │   │
│   │   ├── 📁 styles/           # CSS
│   │   │   └── index.css
│   │   │
│   │   ├── App.js               # Main component
│   │   └── index.js             # Entry point
│   │
│   ├── package.json             # Dependencies
│   ├── tailwind.config.js       # Tailwind CSS config
│   ├── postcss.config.js        # PostCSS config
│   ├── .eslintrc.json           # ESLint config
│   ├── tsconfig.json            # TypeScript config
│   ├── .env.example             # Environment template
│   ├── .gitignore
│   └── Dockerfile
│
├── 📁 .github/
│   └── copilot-instructions.md  # Development guidelines
│
├── 📄 docker-compose.yml        # Docker Compose setup
├── 📄 .gitignore                # Git ignore
├── 📄 README.md                 # Project overview
├── 📄 SETUP.md                  # Installation guide
├── 📄 START_HERE.md             # Getting started
├── 📄 PROJECT_SUMMARY.md        # Technical overview
├── 📄 QUICK_REFERENCE.md        # Cheat sheet
├── 📄 start.bat                 # Windows quick start
└── 📄 start.sh                  # Unix quick start
```

---

## Request/Response Cycle Example

### Example: Create Appointment

**Request:**
```
POST /api/appointments
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "serviceId": "507f1f77bcf86cd799439011",
  "appointmentDate": "2024-02-20",
  "startTime": "10:00",
  "endTime": "10:30",
  "notes": "Please give me a fade"
}
```

**Processing:**
1. Routes: `appointmentRoutes.js` matches POST /api/appointments
2. Middleware: `auth.js` verifies JWT token
3. Controller: `appointmentController.create()` validates and saves
4. Model: `Appointment.js` saves to MongoDB
5. Response: Returns saved appointment with _id and status

**Response:**
```json
{
  "success": true,
  "message": "Appointment created successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439012",
    "customer": "507f1f77bcf86cd799439001",
    "service": "507f1f77bcf86cd799439011",
    "appointmentDate": "2024-02-20T00:00:00.000Z",
    "startTime": "10:00",
    "endTime": "10:30",
    "status": "pending",
    "notes": "Please give me a fade",
    "totalPrice": 25,
    "createdAt": "2024-01-15T12:30:00.000Z",
    "updatedAt": "2024-01-15T12:30:00.000Z"
  }
}
```

---

**Congratulations! You now understand the complete architecture of your Bookplus Booking Application!**
