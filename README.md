# 💈 Barbershop Booking Application

A full-stack MERN application for managing barbershop appointments, services, and customers with a modern, responsive user interface.

## ✨ Features

- **🔐 User Authentication**: Secure login/registration with JWT tokens
- **💇 Service Management**: Create, edit, and manage barbershop services
- **📅 Appointment Booking**: Easy-to-use appointment scheduling system
- **👨‍💼 Admin Dashboard**: Comprehensive management tools
- **🎨 Responsive Design**: Works seamlessly on desktop, tablet, and mobile
- **⚡ Real-time Updates**: Live availability and status updates
- **🔒 Role-based Access**: Customer and admin roles with proper authorization

## 🛠️ Tech Stack

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **MongoDB** - NoSQL database
- **Mongoose** - ODM for MongoDB
- **JWT** - Secure authentication
- **bcryptjs** - Password hashing

### Frontend
- **React.js** - UI library
- **Tailwind CSS** - Utility-first CSS framework
- **React Router** - Client-side routing
- **Axios** - HTTP client
- **Context API** - State management

## 📁 Project Structure

```
Booking Application/
├── server/                 # Backend API
│   ├── src/
│   │   ├── models/        # Database models
│   │   ├── routes/        # API routes
│   │   ├── controllers/   # Route handlers
│   │   ├── middleware/    # Custom middleware
│   │   └── utils/         # Helper functions
│   ├── server.js          # Main entry point
│   ├── package.json
│   └── .env.example
│
├── client/                 # Frontend React app
│   ├── public/            # Static files
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── pages/         # Page components
│   │   ├── services/      # API services
│   │   ├── context/       # Context providers
│   │   ├── hooks/         # Custom hooks
│   │   ├── styles/        # CSS styles
│   │   └── App.js         # Main component
│   ├── package.json
│   ├── tailwind.config.js
│   └── .env.example
│
├── docker-compose.yml     # Docker composition
├── SETUP.md              # Detailed setup guide
└── README.md             # This file
```

## 🚀 Quick Start

### Prerequisites
- Node.js (v14 or higher)
- MongoDB (local or Docker)
- npm or yarn

### Option 1: Local Development

1. **Clone and navigate to the project:**
   ```bash
   cd "Booking Application"
   ```

2. **Set up backend:**
   ```bash
   cd server
   cp .env.example .env
   npm install
   npm run dev  # Runs with nodemon for auto-reload
   ```

3. **Set up frontend (in a new terminal):**
   ```bash
   cd client
   cp .env.example .env
   npm install
   npm start
   ```

The application will open at `http://localhost:3000`

### Option 2: Using Docker Compose

```bash
docker-compose up -d
```

This automatically sets up MongoDB, backend, and frontend.

## 📚 API Documentation

### Base URL
```
http://localhost:5000/api
```

### Authentication Endpoints
```
POST   /auth/register       - Register new user
POST   /auth/login          - Login user
POST   /auth/logout         - Logout user
GET    /auth/profile        - Get user profile
PUT    /auth/profile        - Update user profile
```

### Service Endpoints
```
GET    /services            - Get all services
GET    /services/:id        - Get service details
POST   /services            - Create service (admin)
PUT    /services/:id        - Update service (admin)
DELETE /services/:id        - Delete service (admin)
```

### Appointment Endpoints
```
GET    /appointments                      - Get all appointments (admin)
GET    /appointments/my-appointments      - Get user's appointments
POST   /appointments                      - Create appointment
PUT    /appointments/:id                  - Update appointment
POST   /appointments/:id/cancel            - Cancel appointment
```

## 🔧 Environment Configuration

### Server (.env)
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/barbershop
JWT_SECRET=your_super_secret_key_here
NODE_ENV=development
JWT_EXPIRE=7d
REFRESH_TOKEN_SECRET=your_refresh_secret_key
REFRESH_TOKEN_EXPIRE=30d
```

### Client (.env)
```
REACT_APP_API_URL=http://localhost:5000
```

## 💾 Database Models

### User Schema
- name, email, password (hashed), phone
- role (customer/admin), isActive, avatar
- Timestamps (createdAt, updatedAt)

### Service Schema
- name, description, price, duration
- image, isActive, createdBy (admin reference)
- Timestamps

### Appointment Schema
- customer, service, appointmentDate
- startTime, endTime, status
- notes, totalPrice, cancellationReason
- Timestamps

### TimeSlot Schema
- date, startTime, endTime, isAvailable
- appointment reference, timestamps

## 🎯 Available Routes

### Public Routes
- `/` - Home page
- `/login` - Login page
- `/register` - Registration page
- `/services` - Services list

### Protected Routes (Login Required)
- `/book-appointment` - Book new appointment
- `/appointments` - View my appointments

### Admin Routes
- Dashboard (coming soon)
- Service management
- All appointments management

## 🤝 Key Features Breakdown

### Authentication
- Secure JWT-based authentication
- Password hashing with bcryptjs
- Token expiration and refresh mechanism
- Role-based access control

### Appointments
- Schedule appointments with specific time slots
- View appointment history
- Cancel appointments with reasons
- Status tracking (pending, confirmed, completed, cancelled)

### Services
- Browse available services
- View service details (price, duration)
- Admin management tools

## 📖 For More Information

Please see **[SETUP.md](./SETUP.md)** for:
- Detailed installation instructions
- Troubleshooting guide
- Testing API endpoints
- Next steps for enhancement
- Docker setup details

## 🐛 Troubleshooting

**MongoDB connection error?**
- Ensure MongoDB is running: `mongod`
- Check MongoDB connection string in `.env`

**Port already in use?**
- Change the PORT in `.env` file
- Restart the application

**Dependencies missing?**
- Delete `node_modules` and reinstall: `npm install`

## 🚀 Future Enhancements

- [ ] Admin dashboard with analytics
- [ ] Email notifications
- [ ] Payment integration (Stripe)
- [ ] Appointment reminders
- [ ] Real-time notifications (Socket.io)
- [ ] Photo gallery for barbers
- [ ] Customer reviews and ratings
- [ ] SMS notifications

## 📄 License

MIT License - feel free to use this project for commercial or personal purposes.

## 👥 Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues.

## 📧 Support

For questions or support, please reach out to the development team or create an issue in the repository.
