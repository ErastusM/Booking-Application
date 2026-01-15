#!/bin/bash

# Barbershop Booking Application - Quick Start Script for Unix/Linux/macOS

echo ""
echo "====================================================="
echo "   Barbershop Booking Application - Setup"
echo "====================================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed. Please install Node.js from https://nodejs.org/"
    exit 1
fi

echo "[OK] Node.js is installed"
echo ""

# Ask user for setup option
echo "Choose setup option:"
echo "1. Install dependencies only"
echo "2. Install dependencies and start dev servers"
echo "3. Start existing dev servers"
echo ""

read -p "Enter your choice (1-3): " choice

case $choice in
    1)
        install_deps
        ;;
    2)
        install_deps
        start_servers
        ;;
    3)
        start_servers
        ;;
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac

install_deps() {
    echo ""
    echo "Installing backend dependencies..."
    cd server
    
    if [ -d "node_modules" ]; then
        echo "Backend dependencies already installed."
    else
        npm install
    fi
    
    if [ -f ".env" ]; then
        echo ".env file exists."
    else
        echo "Creating .env from .env.example..."
        cp .env.example .env
    fi
    
    cd ..
    
    echo ""
    echo "Installing frontend dependencies..."
    cd client
    
    if [ -d "node_modules" ]; then
        echo "Frontend dependencies already installed."
    else
        npm install
    fi
    
    if [ -f ".env" ]; then
        echo ".env file exists."
    else
        echo "Creating .env from .env.example..."
        cp .env.example .env
    fi
    
    cd ..
    echo ""
    echo "[OK] Dependencies installed successfully!"
}

start_servers() {
    echo ""
    echo "Starting servers..."
    echo ""
    echo "[INFO] Make sure MongoDB is running on port 27017"
    echo ""
    
    # Start backend server
    cd server
    echo "Starting Backend Server on port 5000..."
    npm run dev &
    BACKEND_PID=$!
    cd ..
    
    # Give backend time to start
    sleep 2
    
    # Start frontend server
    cd client
    echo "Starting Frontend Server on port 3000..."
    npm start &
    FRONTEND_PID=$!
    cd ..
    
    echo ""
    echo "[OK] Servers are starting"
    echo "Backend: http://localhost:5000"
    echo "Frontend: http://localhost:3000"
    echo ""
    echo "Press Ctrl+C to stop all servers"
    echo ""
    
    # Wait for both processes
    wait
}

exit 0
