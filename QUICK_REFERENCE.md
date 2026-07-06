# 🚀 Quick Reference Guide

## Start Development in 30 Seconds

### Windows
```bash
cd "Booking Application"
start.bat
```

### macOS/Linux
```bash
cd "Booking Application"
chmod +x start.sh
./start.sh
```

### Manual
```bash
# Terminal 1 - Backend
cd apps/api && npm install && npm run dev

# Terminal 2 - Frontend
pnpm install && cd client && npm start
```

---

## 🔗 Important URLs

| Service | URL | Port |
|---------|-----|------|
| Frontend | http://localhost:3000 | 3000 |
| Backend API | http://localhost:5000 | 5000 |
| MongoDB | localhost | 27017 |
| API Health | http://localhost:5000/api/health | 5000 |

---

## 📚 Key Files & What They Do

| File | Purpose |
|------|---------|
| `apps/api/server.js` | Main backend entry point |
| `client/src/App.js` | Main frontend app component |
| `apps/api/src/models/User.js` | User database schema |
| `apps/api/src/middleware/auth.js` | JWT authentication logic |
| `client/src/context/AuthContext.js` | React auth state management |
| `client/src/services/api.js` | API client configuration |

---

## 🔑 Test Credentials (After Setup)

### Admin Account
```
Email: admin@bookplus.com
Password: admin123
```

### Regular Customer
```
Email: customer@bookplus.com
Password: customer123
```

*Note: Create these accounts after first run using the registration page*

---

## 💾 Database & MongoDB

### Check MongoDB Status
```bash
# Windows - MongoDB should auto-run
# macOS/Linux
mongod

# Or with Docker
docker run -d -p 27017:27017 --name bookplus-mongo mongo:6.0
```

### MongoDB Connection String
```
mongodb://localhost:27017/bookplus
```

### Access MongoDB CLI
```bash
mongosh

# Switch to database
use bookplus

# View collections
show collections

# Query users
db.users.find()
```

---

## 📝 Common Commands

### Backend Commands
```bash
cd apps/api

npm install          # Install dependencies
npm start            # Run production
npm run dev          # Run with auto-reload (nodemon)
npm test             # Run tests
```

### Frontend Commands
```bash
pnpm install         # Install dependencies (run at the REPO ROOT — pnpm workspace)

cd client
npm start            # Start dev server
npm run build        # Build for production
npm test             # Run tests
```

### Docker Commands
```bash
docker-compose up -d    # Start all services
docker-compose down     # Stop all services
docker-compose logs -f  # View logs
docker-compose ps       # List containers
```

---

## 🧪 Testing API with cURL or Postman

### Register User
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "password": "password123",
    "phone": "123-456-7890"
  }'
```

### Login
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "password123"
  }'
```

### Get Services
```bash
curl http://localhost:5000/api/services
```

### Create Appointment (with token)
```bash
curl -X POST http://localhost:5000/api/appointments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "serviceId": "SERVICE_ID",
    "appointmentDate": "2024-02-15",
    "startTime": "10:00",
    "endTime": "10:30",
    "notes": "Please give me a fade"
  }'
```

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| Port 3000 in use | Kill process: `lsof -ti:3000 \| xargs kill` or change PORT in .env |
| Port 5000 in use | Change PORT in apps/api/.env |
| MongoDB connection error | Ensure MongoDB running: `mongod` or Docker container |
| Module not found | Delete node_modules and run `npm install` again |
| CORS error | Check REACT_APP_API_URL in client/.env |
| npm install slow | Try `npm cache clean --force` then `npm install` |

---

## 📁 Project Structure Cheat Sheet

```
Booking Application/
├── apps/api/
│   ├── src/models/        ← Database schemas
│   ├── src/controllers/   ← Business logic
│   ├── src/routes/        ← API endpoints
│   ├── src/middleware/    ← Authentication, error handling
│   ├── src/utils/         ← Helper functions
│   └── server.js          ← Main entry
│
├── client/
│   ├── src/pages/         ← Full page components
│   ├── src/components/    ← Reusable components
│   ├── src/services/      ← API calls
│   ├── src/context/       ← State management
│   ├── src/hooks/         ← Custom hooks
│   ├── src/styles/        ← CSS
│   └── App.js             ← Main app
│
└── docker-compose.yml     ← Docker setup
```

---

## 🎨 Frontend Customization

### Colors (Tailwind)
Edit `client/tailwind.config.js`:
```js
theme: {
  extend: {
    colors: {
      primary: '#FCD34D',  // Yellow
      dark: '#1F2937',     // Dark gray
    },
  },
}
```

### Add New Page
1. Create file: `client/src/pages/NewPage.js`
2. Add route in `client/src/App.js`:
```js
<Route path="/new-page" element={<NewPage />} />
```

### Add New API Service
Update `client/src/services/index.js`:
```js
export const newService = {
  getData: () => API.get('/endpoint'),
  postData: (data) => API.post('/endpoint', data),
};
```

---

## 🔐 Environment Variables Guide

### Critical Variables (Must Change)
- `JWT_SECRET` - Use a strong random string
- `REFRESH_TOKEN_SECRET` - Use a strong random string
- `MONGODB_URI` - Your database connection string

### Optional Variables
- `PORT` - Backend port (default: 5000)
- `NODE_ENV` - development/production
- `JWT_EXPIRE` - Token expiration (default: 7d)

---

## 📊 Project Architecture

```
User → Frontend (React) → Backend (Express) → Database (MongoDB)
  ↓         ↓              ↓                      ↓
Browser    UI State       API Routes           Collections
           Management     Controllers          Schemas
           Context API    Middleware
```

---

## 🚀 Deployment Checklist

Before deploying to production:

- [ ] Change all secret keys in .env
- [ ] Update MONGODB_URI to production database
- [ ] Set NODE_ENV=production
- [ ] Update REACT_APP_API_URL to production backend
- [ ] Build frontend: `npm run build`
- [ ] Test all features
- [ ] Set up SSL/HTTPS
- [ ] Configure email notifications
- [ ] Set up monitoring and logging
- [ ] Create database backups
- [ ] Test payment integration (if added)

---

## 📞 Need Help?

1. Check **SETUP.md** for detailed instructions
2. Review **PROJECT_SUMMARY.md** for complete overview
3. Check **README.md** for feature list
4. Review error messages in console
5. Check MongoDB logs
6. Use browser DevTools (F12) for frontend issues

---

## 🎯 Common Tasks

### Add a New Service Type
1. Go to Services page (http://localhost:3000/services)
2. Create account as admin
3. Should see admin dashboard
4. Add service through admin panel

### Book an Appointment
1. Login as customer
2. Go to Services page
3. Click "Book Appointment"
4. Fill in details and submit

### View Appointments
1. Login as customer
2. Go to "My Appointments"
3. See all your bookings
4. Cancel if needed

### Manage Services (Admin)
1. Login as admin
2. Go to Dashboard
3. Create/Edit/Delete services

---

**Version:** 1.0.0  
**Last Updated:** January 15, 2026  
**Status:** Ready for Development
