import React, { useEffect, useState } from 'react';
import { appointmentService, serviceService, userService } from '../services';

const AdminDashboard = () => {
    const [activeTab, setActiveTab] = useState('appointments');
    const [appointments, setAppointments] = useState([]);
    const [services, setServices] = useState([]);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Service form state
    const [showServiceForm, setShowServiceForm] = useState(false);
    const [editingService, setEditingService] = useState(null);
    const [serviceForm, setServiceForm] = useState({ name: '', description: '', price: '', duration: '' });

    useEffect(() => {
        fetchAll();
    }, []);

    const fetchAll = async () => {
        setLoading(true);
        try {
            const [apptRes, svcRes, userRes] = await Promise.all([
                appointmentService.getAllAppointments(),
                serviceService.getAllServices(),
                userService.getAllUsers(),
            ]);
            setAppointments(apptRes.data.data);
            setServices(svcRes.data.data);
            setUsers(userRes.data.data);
        } catch (err) {
            setError('Failed to load dashboard data');
        } finally {
            setLoading(false);
        }
    };

    // Appointments
    const handleUpdateStatus = async (id, status) => {
        try {
            await appointmentService.updateAppointment(id, { status });
            setAppointments(appointments.map(a => a._id === id ? { ...a, status } : a));
        } catch {
            setError('Failed to update appointment status');
        }
    };

    // Services
    const handleServiceSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editingService) {
                await serviceService.updateService(editingService._id, serviceForm);
            } else {
                await serviceService.createService(serviceForm);
            }
            await fetchAll();
            setShowServiceForm(false);
            setEditingService(null);
            setServiceForm({ name: '', description: '', price: '', duration: '' });
        } catch {
            setError('Failed to save service');
        }
    };

    const handleEditService = (service) => {
        setEditingService(service);
        setServiceForm({ name: service.name, description: service.description, price: service.price, duration: service.duration });
        setShowServiceForm(true);
    };

    const handleDeleteService = async (id) => {
        if (window.confirm('Delete this service?')) {
            try {
                await serviceService.deleteService(id);
                setServices(services.filter(s => s._id !== id));
            } catch {
                setError('Failed to delete service');
            }
        }
    };

    // Users
    const handleDeleteUser = async (id) => {
        if (window.confirm('Delete this user?')) {
            try {
                await userService.deleteUser(id);
                setUsers(users.filter(u => u._id !== id));
            } catch {
                setError('Failed to delete user');
            }
        }
    };

    const handleRoleChange = async (id, role) => {
        try {
            await userService.updateUserRole(id, role);
            setUsers(users.map(u => u._id === id ? { ...u, role } : u));
        } catch {
            setError('Failed to update role');
        }
    };

    const statusColor = (status) => {
        if (status === 'cancelled') return 'bg-red-100 text-red-700';
        if (status === 'completed') return 'bg-green-100 text-green-700';
        if (status === 'confirmed') return 'bg-blue-100 text-blue-700';
        return 'bg-yellow-100 text-yellow-700';
    };

    if (loading) return <div className="text-center py-20 text-gray-600">Loading dashboard...</div>;

    return (
        <div className="container mx-auto px-4 py-10">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Admin Dashboard</h1>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="bg-white rounded-lg shadow p-5 text-center">
                    <p className="text-gray-500 text-sm">Total Appointments</p>
                    <p className="text-3xl font-bold text-gray-800">{appointments.length}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-5 text-center">
                    <p className="text-gray-500 text-sm">Total Services</p>
                    <p className="text-3xl font-bold text-gray-800">{services.length}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-5 text-center">
                    <p className="text-gray-500 text-sm">Total Users</p>
                    <p className="text-3xl font-bold text-gray-800">{users.length}</p>
                </div>
            </div>

            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                    {error}
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-2 mb-6 border-b border-gray-200">
                {['appointments', 'services', 'users'].map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-6 py-2 font-semibold capitalize transition rounded-t-lg ${activeTab === tab ? 'bg-yellow-400 text-black' : 'text-gray-500 hover:text-gray-800'}`}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {/* Appointments Tab */}
            {activeTab === 'appointments' && (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    {appointments.length === 0 ? (
                        <p className="text-center text-gray-500 py-10">No appointments yet</p>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                                <tr>
                                    <th className="px-4 py-3 text-left">Customer</th>
                                    <th className="px-4 py-3 text-left">Service</th>
                                    <th className="px-4 py-3 text-left">Date</th>
                                    <th className="px-4 py-3 text-left">Time</th>
                                    <th className="px-4 py-3 text-left">Price</th>
                                    <th className="px-4 py-3 text-left">Status</th>
                                    <th className="px-4 py-3 text-left">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {appointments.map(a => (
                                    <tr key={a._id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3">{a.customer?.name}<br /><span className="text-gray-400 text-xs">{a.customer?.email}</span></td>
                                        <td className="px-4 py-3">{a.service?.name}</td>
                                        <td className="px-4 py-3">{new Date(a.appointmentDate).toLocaleDateString()}</td>
                                        <td className="px-4 py-3">{a.startTime} - {a.endTime}</td>
                                        <td className="px-4 py-3">${a.totalPrice}</td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusColor(a.status)}`}>
                                                {a.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <select
                                                value={a.status}
                                                onChange={e => handleUpdateStatus(a._id, e.target.value)}
                                                className="text-xs border border-gray-300 rounded px-2 py-1"
                                            >
                                                <option value="pending">Pending</option>
                                                <option value="confirmed">Confirmed</option>
                                                <option value="completed">Completed</option>
                                                <option value="cancelled">Cancelled</option>
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* Services Tab */}
            {activeTab === 'services' && (
                <div>
                    <button
                        onClick={() => { setShowServiceForm(!showServiceForm); setEditingService(null); setServiceForm({ name: '', description: '', price: '', duration: '' }); }}
                        className="mb-4 bg-yellow-400 text-black font-bold px-5 py-2 rounded-lg hover:bg-yellow-500 transition"
                    >
                        {showServiceForm ? 'Cancel' : '+ Add Service'}
                    </button>

                    {showServiceForm && (
                        <form onSubmit={handleServiceSubmit} className="bg-white rounded-lg shadow p-6 mb-6 grid grid-cols-2 gap-4">
                            <div className="col-span-2">
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Name</label>
                                <input required value={serviceForm.name} onChange={e => setServiceForm({ ...serviceForm, name: e.target.value })}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                            </div>
                            <div className="col-span-2">
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
                                <textarea required value={serviceForm.description} onChange={e => setServiceForm({ ...serviceForm, description: e.target.value })}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2" rows="2" />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Price ($)</label>
                                <input required type="number" value={serviceForm.price} onChange={e => setServiceForm({ ...serviceForm, price: e.target.value })}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Duration (mins)</label>
                                <input required type="number" value={serviceForm.duration} onChange={e => setServiceForm({ ...serviceForm, duration: e.target.value })}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                            </div>
                            <div className="col-span-2">
                                <button type="submit" className="bg-yellow-400 text-black font-bold px-6 py-2 rounded-lg hover:bg-yellow-500 transition">
                                    {editingService ? 'Update Service' : 'Create Service'}
                                </button>
                            </div>
                        </form>
                    )}

                    <div className="bg-white rounded-lg shadow overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                                <tr>
                                    <th className="px-4 py-3 text-left">Name</th>
                                    <th className="px-4 py-3 text-left">Description</th>
                                    <th className="px-4 py-3 text-left">Price</th>
                                    <th className="px-4 py-3 text-left">Duration</th>
                                    <th className="px-4 py-3 text-left">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {services.map(s => (
                                    <tr key={s._id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3 font-semibold">{s.name}</td>
                                        <td className="px-4 py-3 text-gray-500">{s.description}</td>
                                        <td className="px-4 py-3">${s.price}</td>
                                        <td className="px-4 py-3">{s.duration} min</td>
                                        <td className="px-4 py-3 flex gap-2">
                                            <button onClick={() => handleEditService(s)}
                                                className="text-blue-600 hover:underline text-xs font-semibold">Edit</button>
                                            <button onClick={() => handleDeleteService(s._id)}
                                                className="text-red-600 hover:underline text-xs font-semibold">Delete</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Users Tab */}
            {activeTab === 'users' && (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                            <tr>
                                <th className="px-4 py-3 text-left">Name</th>
                                <th className="px-4 py-3 text-left">Email</th>
                                <th className="px-4 py-3 text-left">Phone</th>
                                <th className="px-4 py-3 text-left">Role</th>
                                <th className="px-4 py-3 text-left">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {users.map(u => (
                                <tr key={u._id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 font-semibold">{u.name}</td>
                                    <td className="px-4 py-3 text-gray-500">{u.email}</td>
                                    <td className="px-4 py-3">{u.phone}</td>
                                    <td className="px-4 py-3">
                                        <select
                                            value={u.role}
                                            onChange={e => handleRoleChange(u._id, e.target.value)}
                                            className="text-xs border border-gray-300 rounded px-2 py-1"
                                        >
                                            <option value="customer">Customer</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    </td>
                                    <td className="px-4 py-3">
                                        <button onClick={() => handleDeleteUser(u._id)}
                                            className="text-red-600 hover:underline text-xs font-semibold">Delete</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default AdminDashboard;