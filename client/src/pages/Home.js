import React from 'react';
import { Link } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';

const Home = () => {
  const { user } = useAuthContext();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white">
      <div className="container mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4 text-yellow-400">
            Welcome to BarberShop Booking
          </h1>
          <p className="text-xl text-gray-300 mb-8">
            Book your perfect haircut with our professional barbers
          </p>

          {!user && (
            <div className="flex gap-4 justify-center">
              <Link
                to="/login"
                className="bg-gray-700 hover:bg-gray-600 px-8 py-3 rounded-lg font-semibold transition"
              >
                Login
              </Link>
              <Link
                to="/register"
                className="bg-yellow-400 text-black hover:bg-yellow-500 px-8 py-3 rounded-lg font-semibold transition"
              >
                Sign Up
              </Link>
            </div>
          )}

          {user && (
            <Link
              to="/services"
              className="inline-block bg-yellow-400 text-black hover:bg-yellow-500 px-8 py-3 rounded-lg font-semibold transition"
            >
              Browse Services
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-gray-800 rounded-lg p-6 text-center">
            <div className="text-4xl mb-4">✂️</div>
            <h3 className="text-xl font-bold mb-2">Professional Barbers</h3>
            <p className="text-gray-400">
              Our experienced barbers provide top-quality haircuts and grooming services
            </p>
          </div>

          <div className="bg-gray-800 rounded-lg p-6 text-center">
            <div className="text-4xl mb-4">📅</div>
            <h3 className="text-xl font-bold mb-2">Easy Scheduling</h3>
            <p className="text-gray-400">
              Book your appointment online with just a few clicks
            </p>
          </div>

          <div className="bg-gray-800 rounded-lg p-6 text-center">
            <div className="text-4xl mb-4">⏰</div>
            <h3 className="text-xl font-bold mb-2">Flexible Hours</h3>
            <p className="text-gray-400">
              Find time slots that work best for your schedule
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
