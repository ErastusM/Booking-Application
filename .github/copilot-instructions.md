# Barbershop Booking Application Development Guide

This document provides guidance for developing the Barbershop Booking Application.

## Project Overview

A full-stack MERN application for managing barbershop appointments with user authentication, service management, and admin dashboard.

## Technology Stack

- **Frontend**: React.js, Tailwind CSS, React Router
- **Backend**: Node.js, Express.js, MongoDB, Mongoose
- **Authentication**: JWT
- **Testing**: Jest, React Testing Library

## Development Guidelines

### Code Structure

- Keep components small and focused
- Use custom hooks for shared logic
- Follow RESTful API design patterns
- Use environment variables for configuration
- Implement proper error handling and validation

### Database Models

- User (customers and admins)
- Service
- Appointment
- TimeSlot

### Authentication Flow

- JWT tokens for stateless authentication
- Refresh tokens for session management
- Role-based access control (customer, admin)

### API Conventions

- Use standard HTTP methods
- Return consistent JSON responses
- Include proper status codes
- Implement rate limiting for production

### Frontend Best Practices

- Use functional components and hooks
- Implement lazy loading for routes
- Add loading states and error boundaries
- Validate user input on client and server
- Responsive design for all screen sizes

### Backend Best Practices

- Input validation and sanitization
- Error handling middleware
- Logging and monitoring
- Security headers and CORS configuration
- Database indexing for performance

## Getting Started

See README.md for installation and running instructions.
