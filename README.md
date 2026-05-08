# � Multi-Booking Application

A full-stack MERN platform for booking multiple types of services across various categories. One unified account with multiple roles — customers can browse and book services, providers can manage their availability and bookings, and admins can oversee the entire ecosystem. Features a robust waiting list system, role-based dashboards, and seamless payment integration.

## ✨ Core Features

### 🎯 Universal Features
- **🔐 Single Login, Multiple Roles**: One account that works as Customer, Provider, and/or Admin with role switching
- **🔍 Smart Service Discovery**: Search bar, service categories, featured & recently booked services
- **📱 Onboarding Flow**: Welcome screen, app overview, optional location access
- **🎨 Responsive Design**: Optimized for desktop, tablet, and mobile devices

### 👤 Customer Features
- **📅 Easy Booking**: 12-step streamlined booking flow
- **⏱️ Flexible Duration**: Adjustable hours/units with real-time price calculations
- **💰 Multiple Payment Options**: Cash, card, wallet, mobile money
- **🗺️ Location-Based Services**: Search nearby providers
- **📍 Saved Addresses**: Manage multiple booking locations
- **✅ Booking Management**: View, reschedule, or cancel appointments
- **⭐ Reviews & Ratings**: Rate services and leave feedback
- **🎯 Waiting List**: Join queues when preferred slots are full
- **📊 Complete History**: Track all bookings and payment records

### 🔧 Provider Features
- **📋 Dashboard**: View today's bookings and full calendar
- **✔️ Appointment Control**: Accept, decline, or mark as completed
- **📅 Availability Management**: Set working hours and availability
- **💵 Earnings Tracking**: Monitor income and payment history
- **⭐ Profile & Ratings**: Build reputation through customer reviews
- **🎯 Waiting List Management**: View and process waiting list requests
- **📱 In-app Messaging**: Contact with customers about bookings

### 🛡️ Admin Features
- **👥 User Management**: Manage customers and providers
- **💼 Service Management**: Create, edit, and manage service offerings
- **📊 Complete Booking Visibility**: Monitor all bookings across the platform
- **💰 Pricing Control**: Adjust pricing and service fees
- **🎯 Waiting List Oversight**: Monitor and manage queue systems
- **⚠️ Dispute Resolution**: Handle conflicts between customers and providers
- **📈 Analytics Dashboard**: Track platform metrics and user activity

## � User Roles & Role Switching

### One Account, Multiple Roles

A user creates a single account and can switch between different roles based on their needs:

| Feature | Customer | Provider | Admin |
|---------|----------|----------|-------|
| Browse & Book Services | ✅ | ❌ | ✅ |
| Manage Availability | ❌ | ✅ | ✅ |
| View Bookings | ✅ | ✅ | ✅ |
| Accept/Decline Jobs | ❌ | ✅ | ✅ |
| Manage Users & Services | ❌ | ❌ | ✅ |
| View Analytics | ❌ | ✅ | ✅ |
| Process Payments | ✅ | ❌ | ✅ |

### Adding Roles

**Option A**: During sign-up, users select their primary role:
- "What do you want to use the app for?"
  - Book services
  - Offer services
  - Manage the platform

**Option B** (Recommended): Users can add additional roles after signup via settings, allowing the same account to:
- Book services today
- Switch to provider mode tomorrow to accept bookings
- Access admin features if granted permissions

---

## 📊 User Journey - 12-Step Booking Flow

### **1. Onboarding**
- Welcome screen with app overview
- Explanation of available services
- Optional location access request for nearby provider discovery

### **2. Login / Sign Up**
- **Sign-up**: Phone/email, password or OTP, full name, contact, email, location
- **Login**: Quick authentication with JWT tokens
- Option to continue as guest (limited functionality)

### **3. Home / Dashboard**
- **Search bar**: "What do you want to book?"
- **Service categories**: Displayed as icon cards
- **Featured services**: Popular or promoted offerings
- **Recently booked**: Quick re-booking of previous services

### **4. Service Selection**
- Service name and description
- Base price and pricing structure (per hour, per unit, etc.)
- Provider rating and review count
- Service images and detailed specifications

### **5. Time & Duration Setup** ⭐ Enhanced
- **Date picker**: Select any available date
- **Start time**: Choose preferred time slot
- **Adjustable duration**: 
  - Increase/decrease hours or service units
  - Real-time total price updates
  - Visual breakdown showing: base + duration cost
- **Add extras**: Additional services or special requests
- **Notes field**: Special instructions for provider

### **6. Provider Selection** (Optional)
- **Auto-assign**: System suggests available provider
- **Manual selection**: Browse available providers with:
  - Ratings and reviews
  - Years of experience
  - Price differences (if applicable)
  - Availability indicator

### **7. Booking Summary**
- Service name and description
- Selected date, time, and duration
- Location details
- Assigned provider with rating
- **Price breakdown**:
  - Base service cost
  - Duration/unit costs
  - Extras or add-ons
  - **Total amount**

### **8. Confirm Booking**
- Final review of all details
- Accept terms & conditions
- Option to modify or go back

### **9. Payment & Confirmation**
- **Payment methods**:
  - 💵 Cash (pay at location)
  - 💳 Card (debit/credit)
  - 🏦 Wallet (in-app credits)
  - 📱 Mobile money (local providers)
- **Confirmation screen**:
  - Booking ID (for tracking)
  - Confirmation date, time, and location
  - Provider details and contact
  - SMS/email/in-app notification sent
  - Receipt download option

### **10. Active Booking Tracking**
- Real-time status: Confirmed → In Progress → Completed
- Provider location (if applicable)
- Direct contact option with provider
- **Cancellation/Reschedule**:
  - Available within time limit
  - Cancellation fees may apply
  - Rescheduling to alternative slots

### **11. Completion & Review**
- Mark booking as completed
- **Rate the service**: 1-5 star rating
- **Write a review**: Detailed feedback
- **Tip provider** (optional): Reward good service
- Share experience on social media (optional)

### **12. Profile & History**
- **User profile**: Name, contact, email, preferences
- **Saved addresses**: Multiple locations for quick booking
- **Booking history**: All past and upcoming bookings
- **Payment history**: Detailed transaction records
- **Support & Help**: FAQs, contact support, report issues

---

## 🎯 Waiting List System

When preferred time slots are unavailable:

- **Join Queue**: Customer can add themselves to a waiting list
- **Queue Position**: Shows current place in line
- **Notifications**: 
  - SMS/email when a slot becomes available
  - In-app alerts for immediate notification
  - Countdown if slot expires
- **Provider View**: See waiting list requests and process them
- **Admin Oversight**: Monitor queue volumes and system performance
- **Flexible Confirmation**: Limited time to confirm before moving to next in queue

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
