import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { notificationService } from '../services';

const NotificationBell = () => {
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const dropdownRef = useRef(null);
    const navigate = useNavigate();

    useEffect(() => {
        fetchNotifications();
        // Poll every 30 seconds for new notifications
        const interval = setInterval(fetchNotifications, 30000);
        return () => clearInterval(interval);
    }, []);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const fetchNotifications = async () => {
        try {
            const res = await notificationService.getMyNotifications();
            setNotifications(res.data.data);
            setUnreadCount(res.data.unreadCount);
            setError('');
        } catch (err) {
            if (err.response?.status !== 401) {
                setError('Failed to load notifications');
            }
        }
    };

    const handleOpen = async () => {
        setOpen(!open);
    };

    const handleMarkAllRead = async () => {
        setLoading(true);
        try {
            await notificationService.markAllRead();
            setNotifications(notifications.map(n => ({ ...n, read: true })));
            setUnreadCount(0);
        } catch (err) {
            setError('Failed to mark notifications as read');
        } finally {
            setLoading(false);
        }
    };

    const handleClick = async (notification) => {
        try {
            await notificationService.markOneRead(notification._id);
            setNotifications(notifications.map(n =>
                n._id === notification._id ? { ...n, read: true } : n
            ));
            setUnreadCount(prev => Math.max(0, prev - 1));
            setOpen(false);
            if (notification.link) navigate(notification.link);
        } catch (err) {
            setError('Failed to update notification');
        }
    };

    const handleDelete = async (e, id) => {
        e.stopPropagation();
        try {
            await notificationService.deleteNotification(id);
            const deleted = notifications.find(n => n._id === id);
            setNotifications(notifications.filter(n => n._id !== id));
            if (!deleted.read) setUnreadCount(prev => Math.max(0, prev - 1));
        } catch (err) {
            setError('Failed to delete notification');
        }
    };

    const timeAgo = (date) => {
        const seconds = Math.floor((new Date() - new Date(date)) / 1000);
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    };

    const typeIcon = (type) => {
        if (type === 'appointment') return '📅';
        if (type === 'waiting_list') return '🎉';
        return '🔔';
    };

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Bell button */}
            <button
                onClick={handleOpen}
                className="relative p-1 text-white hover:text-yellow-400 transition"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center font-bold">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown — inline styles + CSS vars so it themes in dark mode */}
            {open && (
                <div className="notif-dropdown" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: '320px', maxWidth: '90vw', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg, 0 12px 40px rgba(0,0,0,0.18))', zIndex: 1000, overflow: 'hidden' }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.85rem 1rem', borderBottom: '1px solid var(--border)' }}>
                        <h3 style={{ fontWeight: '700', color: 'var(--charcoal)', fontFamily: 'var(--font-display)', fontSize: '1rem', margin: 0 }}>Notifications</h3>
                        {unreadCount > 0 && (
                            <button onClick={handleMarkAllRead} disabled={loading} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600', color: 'var(--gold-dark)' }}>
                                Mark all read
                            </button>
                        )}
                    </div>

                    {/* Notifications list */}
                    <div style={{ maxHeight: '24rem', overflowY: 'auto' }}>
                        {error && (
                            <div style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', color: 'var(--danger-fg,#b42318)', background: 'var(--danger-bg,#fde8e8)' }}>{error}</div>
                        )}
                        {notifications.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
                                <p style={{ fontSize: '1.75rem', margin: '0 0 0.5rem' }}>🔔</p>
                                <p style={{ fontSize: '0.875rem', margin: 0 }}>No notifications yet</p>
                            </div>
                        ) : (
                            notifications.map(n => (
                                <div
                                    key={n._id}
                                    onClick={() => handleClick(n)}
                                    style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.8rem 1rem', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: !n.read ? 'rgba(201,168,76,0.08)' : 'transparent', transition: 'background 0.15s' }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-sunken)'}
                                    onMouseLeave={e => e.currentTarget.style.background = !n.read ? 'rgba(201,168,76,0.08)' : 'transparent'}
                                >
                                    <span style={{ fontSize: '1.25rem', marginTop: '1px', flexShrink: 0 }}>{typeIcon(n.type)}</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <p style={{ fontSize: '0.85rem', margin: 0, color: !n.read ? 'var(--charcoal)' : 'var(--text-secondary)', fontWeight: !n.read ? '600' : '400', lineHeight: 1.4 }}>
                                            {n.message}
                                        </p>
                                        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>{timeAgo(n.createdAt)}</p>
                                    </div>
                                    <button onClick={(e) => handleDelete(e, n._id)} aria-label="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem', flexShrink: 0, lineHeight: 1 }}>×</button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationBell;