import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { appointmentService, serviceService } from '../services';
import { useAuthContext } from '../context/AuthContext';

const BookAppointment = () => {
    const { user } = useAuthContext();
    const navigate = useNavigate();
    const [services, setServices] = useState([]);
    const [formData, setFormData] = useState({
        serviceId: '',
        appointmentDate: '',
        startTime: '',
        endTime: '',
        notes: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        if (!user) {
            navigate('/login');
        }

        const fetchServices = async () => {
            try {
                const response = await serviceService.getAllServices();
                setServices(response.data.data);
            } catch (err) {
                setError('Failed to fetch services');
            }
        };

        fetchServices();
    }, [user, navigate]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            await appointmentService.createAppointment(formData);
            setSuccess('Appointment booked successfully!');
            setTimeout(() => navigate('/appointments'), 2000);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to book appointment');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container mx-auto px-4 py-12">
            <h1 className="text-4xl font-bold text-gray-800 mb-8">Book an Appointment</h1>

            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                    {error}
                </div>
            )}

            {success && (
                <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
                    {success}
                </div>
            )}

            <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-8">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-gray-700 font-semibold mb-2">Service</label>
                        <select
                            name="serviceId"
                            value={formData.serviceId}
                            onChange={handleChange}
                            required
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                        >
                            <option value="">Select a service</option>
                            {services.map(service => (
                                <option key={service._id} value={service._id}>
                                    {service.name} - ${service.price}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-gray-700 font-semibold mb-2">Appointment Date</label>
                        <input
                            type="date"
                            name="appointmentDate"
                            value={formData.appointmentDate}
                            onChange={handleChange}
                            required
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-gray-700 font-semibold mb-2">Start Time</label>
                            <input
                                type="time"
                                name="startTime"
                                value={formData.startTime}
                                onChange={handleChange}
                                required
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                            />
                        </div>

                        <div>
                            <label className="block text-gray-700 font-semibold mb-2">End Time</label>
                            <input
                                type="time"
                                name="endTime"
                                value={formData.endTime}
                                onChange={handleChange}
                                required
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-gray-700 font-semibold mb-2">Notes (Optional)</label>
                        <textarea
                            name="notes"
                            value={formData.notes}
                            onChange={handleChange}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                            placeholder="Any special requests?"
                            rows="4"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-yellow-400 text-black font-bold py-2 rounded-lg hover:bg-yellow-500 transition disabled:opacity-50"
                    >
                        {loading ? 'Booking...' : 'Book Appointment'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default BookAppointment;
