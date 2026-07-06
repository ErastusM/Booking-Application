@echo off
REM Bookplus Booking Application - Quick Start Script for Windows

echo.
echo =====================================================
echo   Bookplus Booking Application - Setup
echo =====================================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed. Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Node.js is installed
echo.

REM Ask user for setup option
echo Choose setup option:
echo 1. Install dependencies only
echo 2. Install dependencies and start dev servers
echo 3. Start existing dev servers
echo.

set /p choice="Enter your choice (1-3): "

if "%choice%"=="1" (
    call :install_deps
) else if "%choice%"=="2" (
    call :install_deps
    call :start_servers
) else if "%choice%"=="3" (
    call :start_servers
) else (
    echo Invalid choice. Exiting.
    exit /b 1
)

pause
exit /b 0

:install_deps
echo.
echo Installing backend dependencies...
cd apps\api
if exist "node_modules" (
    echo Backend dependencies already installed.
) else (
    npm install
)

if exist ".env" (
    echo .env file exists.
) else (
    echo Creating .env from .env.example...
    copy .env.example .env
)

cd ..\..

echo.
echo Installing frontend dependencies (pnpm workspace: apps + packages)...
where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm is required for the frontend workspace. Install it with: npm install -g pnpm
    exit /b 1
)
call pnpm install
cd apps\customer

if exist ".env" (
    echo .env file exists.
) else (
    echo Creating .env from .env.example...
    copy .env.example .env
)

cd ..
echo.
echo [OK] Dependencies installed successfully!
exit /b 0

:start_servers
echo.
echo Starting servers...
echo.
echo [INFO] Make sure MongoDB is running on port 27017
echo.
echo Opening new terminal windows for backend and frontend...
echo.

REM Start backend server
cd apps\api
start cmd /k "echo Starting Backend Server... && npm run dev"

cd ..\..

REM Start frontend server (customer app)
cd apps\customer
start cmd /k "echo Starting Customer App... && npx vite --port 3002"

cd ..

echo.
echo [OK] Servers should be starting in new windows
echo Backend: http://localhost:5000
echo Frontend: http://localhost:3000
echo.

exit /b 0
