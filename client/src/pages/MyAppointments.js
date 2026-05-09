import React, { useEffect, useState } from 'react';
import { appointmentService, reviewService } from '../services';
import ReviewModal from '../components/ReviewModal';

const MyAppointments = () => {
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [reviewedIds, setReviewedIds] = useState([]);
    const [selectedAppointment, setSelectedAppointment] = useState(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [apptRes, reviewRes] = await Promise.all([
                appointmentService.getAllAppointments(),
                reviewService.getMyReviews(),
            ]);
            setAppointments(apptRes.data.data);
            setReviewedIds(reviewRes.data.data.map(r => r.appointment));
        } catch (err) {
            setError('Failed to fetch appointments');
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = async (appointmentId) => {
        if (window.confirm('Are you sure you want to cancel this appointment?')) {
            try {
                await appointmentService.cancelAppointment(appointmentId, 'Cancelled by customer');
                setAppointments(appointments.map(apt =>
                    apt._id === appointmentId ? { ...apt, status: 'cancelled' } : apt
                ));
            } catch (err) {
                setError('Failed to cancel appointment');
            }
        }
    };

    const statusColor = (status) => {
        if (status === 'cancelled') return 'bg-red-100 text-red-700';
        if (status === 'completed') return 'bg-green-100 text-green-700';
        if (status === 'confirmed') return 'bg-blue-100 text-blue-700';
        return 'bg-yellow-100 text-yellow-700';
    };

    if (loading) return <div className="text-center py-20">Loading appointments...</div>;

    return (
        <div className="container mx-auto px-4 py-12">
            <h1 className="text-4xl font-bold text-gray-800 mb-8">My Appointments</h1>

            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                    {error}
                </div>
            )}

            {appointments.length === 0 ? (
                <div className="bg-white rounded-lg shadow-lg p-8 text-center">
                    <p className="text-gray-600 text-lg">No appointments booked yet.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {appointments.map(appointment => (
                        <div key={appointment._id} className="bg-white rounded-lg shadow-lg p-6">
                            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                                <div>
                                    <p className="text-gray-500 text-sm">Service</p>
                                    <p className="text-lg font-semibold text-gray-800">{appointment.service?.name}</p>
                                </div>
                                <div>
                                    <p className="text-gray-500 text-sm">Date</p>
                                    <p className="text-lg font-semibold text-gray-800">
                                        {new Date(appointment.appointmentDate).toLocaleDateString()}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-gray-500 text-sm">Time</p>
                                    <p className="text-lg font-semibold text-gray-800">
                                        {appointment.startTime} - {appointment.endTime}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-gray-500 text-sm">Price</p>
                                    <p className="text-lg font-semibold text-gray-800">${appointment.totalPrice}</p>
                                </div>
                                <div className="flex flex-col gap-2 items-start">
                                    <span className={`px-3 py-1 rounded-full text-sm font-semibold ${statusColor(appointment.status)}`}>
                                        {appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1)}
                                    </span>
                                    {appointment.status !== 'cancelled' && appointment.status !== 'completed' && (
                                        <button
                                            onClick={() => handleCancel(appointment._id)}
                                            className="text-red-600 hover:text-red-800 font-semibold text-sm"
                                        >
                                            Cancel
                                        </button>
                                    )}
                                    {appointment.status === 'completed' && !reviewedIds.includes(appointment._id) && (
                                        <button
                                            onClick={() => setSelectedAppointment(appointment)}
                                            className="text-yellow-600 hover:text-yellow-800 font-semibold text-sm"
                                        >
                                            ★ Leave a Review
                                        </button>
                                    )}
                                    {appointment.status === 'completed' && reviewedIds.includes(appointment._id) && (
                                        <span className="text-green-600 text-sm font-semibold">✓ Reviewed</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {selectedAppointment && (
                <ReviewModal
                    appointment={selectedAppointment}
                    onClose={() => setSelectedAppointment(null)}
                    onSubmitted={fetchData}
                />
            )}
        </div>
    );
};

export default MyAppointments;