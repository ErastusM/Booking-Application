import React, { useEffect, useState } from 'react';
import { waitingListService } from '../services';

const MyWaitingList = () => {
    const [entries, setEntries] = useState([]);
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [listRes, notifRes] = await Promise.all([
                waitingListService.getMyList(),
                waitingListService.getNotifications(),
            ]);
            setEntries(listRes.data.data);
            setNotifications(notifRes.data.data);
        } catch (err) {
            setError('Failed to load waiting list');
        } finally {
            setLoading(false);
        }
    };

    const handleLeave = async (id) => {
        if (window.confirm('Leave this waiting list?')) {
            try {
                await waitingListService.leave(id);
                setEntries(entries.filter(e => e._id !== id));
            } catch {
                setError('Failed to leave waiting list');
            }
        }
    };

    if (loading) return <div className="text-center py-20 text-gray-600">Loading...</div>;

    return (
        <div className="container mx-auto px-4 py-12 max-w-3xl">
            <h1 className="text-3xl font-bold text-gray-800 mb-8">My Waiting List</h1>

            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                    {error}
                </div>
            )}

            {/* Notifications */}
            {notifications.length > 0 && (
                <div className="mb-8">
                    <h2 className="text-lg font-bold text-gray-700 mb-3">🎉 Good News!</h2>
                    {notifications.map(n => (
                        <div key={n._id} className="bg-green-50 border border-green-300 rounded-lg p-4 mb-3">
                            <p className="text-green-800 font-semibold">
                                You've been promoted off the waiting list for <span className="font-bold">{n.service?.name}</span>!
                            </p>
                            <p className="text-green-600 text-sm mt-1">
                                {new Date(n.appointmentDate).toLocaleDateString()} at {n.startTime} — your appointment has been confirmed.
                            </p>
                        </div>
                    ))}
                </div>
            )}

            {/* Waiting entries */}
            {entries.length === 0 ? (
                <div className="text-center py-20 text-gray-400">
                    <p className="text-5xl mb-4">⏳</p>
                    <p className="text-xl font-semibold">You're not on any waiting lists</p>
                    <p className="text-sm mt-2">When a slot you want is full, you can join its waiting list</p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {entries.map(entry => (
                        <div key={entry._id} className="bg-white rounded-lg shadow p-6 flex items-center justify-between">
                            <div className="flex gap-8">
                                {/* Position badge */}
                                <div className="flex flex-col items-center justify-center w-14 h-14 rounded-full bg-yellow-400 text-black font-bold text-xl shrink-0">
                                    #{entry.position}
                                </div>
                                <div>
                                    <p className="font-bold text-gray-800 text-lg">{entry.service?.name}</p>
                                    <p className="text-gray-500 text-sm mt-1">
                                        {new Date(entry.appointmentDate).toLocaleDateString('en-US', {
                                            weekday: 'long',
                                            year: 'numeric',
                                            month: 'long',
                                            day: 'numeric',
                                        })}
                                    </p>
                                    <p className="text-gray-500 text-sm">{entry.startTime} — {entry.endTime}</p>
                                    <p className="text-yellow-600 text-sm font-semibold mt-1">${entry.service?.price} · {entry.service?.duration} min</p>
                                </div>
                            </div>
                            <button
                                onClick={() => handleLeave(entry._id)}
                                className="text-red-500 hover:text-red-700 text-sm font-semibold border border-red-300 px-4 py-2 rounded-lg hover:bg-red-50 transition"
                            >
                                Leave Queue
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default MyWaitingList;