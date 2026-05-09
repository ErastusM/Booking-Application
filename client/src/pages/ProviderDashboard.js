import React, { useEffect, useState } from 'react';
import { appointmentService } from '../services';

const ProviderDashboard = () => {
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState('pending');

    useEffect(() => {
        fetchAppointments();
    }, []);

    const fetchAppointments = async () => {
        setLoading(true);
        try {
            const res = await appointmentService.getAllAppointments();
            setAppointments(res.data.data);
        } catch (err) {
            setError('Failed to load appointments');
        } finally {
            setLoading(false);
        }
    };

    const handleStatusUpdate = async (id, status) => {
        try {
            await appointmentService.updateAppointmentStatus(id, status);
            setAppointments(appointments.map(a =>
                a._id === id ? { ...a, status } : a
            ));
        } catch {
            setError('Failed to update appointment');
        }
    };

    const filtered = appointments.filter(a => a.status === activeTab);

    const statusColor = (status) => {
        if (status === 'cancelled') return 'bg-red-100 text-red-700';
        if (status === 'completed') return 'bg-green-100 text-green-700';
        if (status === 'confirmed') return 'bg-blue-100 text-blue-700';
        return 'bg-yellow-100 text-yellow-700';
    };

    const counts = {
        pending: appointments.filter(a => a.status === 'pending').length,
        confirmed: appointments.filter(a => a.status === 'confirmed').length,
        completed: appointments.filter(a => a.status === 'completed').length,
        cancelled: appointments.filter(a => a.status === 'cancelled').length,
    };

    if (loading) return <div className="text-center py-20 text-gray-600">Loading...</div>;

    return (
        <div className="container mx-auto px-4 py-10">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Provider Dashboard</h1>
            <p className="text-gray-500 mb-8">Manage your appointments</p>

            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                    {error}
                </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-4 gap-4 mb-8">
                {Object.entries(counts).map(([status, count]) => (
                    <div key={status} className="bg-white rounded-lg shadow p-5 text-center">
                        <p className="text-gray-500 text-sm capitalize">{status}</p>
                        <p className="text-3xl font-bold text-gray-800">{count}</p>
                    </div>
                ))}
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6 border-b border-gray-200">
                {['pending', 'confirmed', 'completed', 'cancelled'].map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-6 py-2 font-semibold capitalize transition rounded-t-lg ${activeTab === tab ? 'bg-yellow-400 text-black' : 'text-gray-500 hover:text-gray-800'}`}
                    >
                        {tab}
                        {counts[tab] > 0 && (
                            <span className="ml-2 bg-gray-200 text-gray-700 text-xs rounded-full px-2 py-0.5">
                                {counts[tab]}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Appointments */}
            {filtered.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                    No {activeTab} appointments
                </div>
            ) : (
                <div className="grid gap-4">
                    {filtered.map(a => (
                        <div key={a._id} className="bg-white rounded-lg shadow p-6 flex items-center justify-between">
                            <div className="flex gap-6">
                                <div>
                                    <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Customer</p>
                                    <p className="font-bold text-gray-800">{a.customer?.name}</p>
                                    <p className="text-sm text-gray-500">{a.customer?.email}</p>
                                    <p className="text-sm text-gray-500">{a.customer?.phone}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Service</p>
                                    <p className="font-bold text-gray-800">{a.service?.name}</p>
                                    <p className="text-sm text-gray-500">${a.service?.price} · {a.service?.duration} min</p>
                                </div>
                                <div>
                                    <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Date & Time</p>
                                    <p className="font-bold text-gray-800">{new Date(a.appointmentDate).toLocaleDateString()}</p>
                                    <p className="text-sm text-gray-500">{a.startTime} - {a.endTime}</p>
                                </div>
                            </div>

                            <div className="flex flex-col items-end gap-3">
                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor(a.status)}`}>
                                    {a.status}
                                </span>
                                {a.status === 'pending' && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleStatusUpdate(a._id, 'confirmed')}
                                            className="bg-green-500 text-white text-xs font-bold px-4 py-1.5 rounded-lg hover:bg-green-600 transition"
                                        >
                                            Accept
                                        </button>
                                        <button
                                            onClick={() => handleStatusUpdate(a._id, 'cancelled')}
                                            className="bg-red-500 text-white text-xs font-bold px-4 py-1.5 rounded-lg hover:bg-red-600 transition"
                                        >
                                            Decline
                                        </button>
                                    </div>
                                )}
                                {a.status === 'confirmed' && (
                                    <button
                                        onClick={() => handleStatusUpdate(a._id, 'completed')}
                                        className="bg-blue-500 text-white text-xs font-bold px-4 py-1.5 rounded-lg hover:bg-blue-600 transition"
                                    >
                                        Mark Complete
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ProviderDashboard;