import React, { useEffect, useState } from 'react';
import { serviceService } from '../services';

const Services = () => {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const response = await serviceService.getAllServices();
        setServices(response.data.data);
      } catch (err) {
        setError('Failed to fetch services');
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, []);

  if (loading) {
    return <div className="text-center py-20">Loading services...</div>;
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="text-4xl font-bold text-gray-800 mb-12 text-center">Our Services</h1>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {services.map(service => (
          <div key={service._id} className="bg-white rounded-lg shadow-lg overflow-hidden hover:shadow-xl transition">
            {service.image && (
              <img src={service.image} alt={service.name} className="w-full h-48 object-cover" />
            )}
            <div className="p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-2">{service.name}</h3>
              <p className="text-gray-600 mb-4">{service.description}</p>
              <div className="flex justify-between items-center">
                <span className="text-2xl font-bold text-yellow-400">${service.price}</span>
                <span className="text-sm text-gray-500">{service.duration} min</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Services;
