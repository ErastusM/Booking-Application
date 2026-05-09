import React, { useEffect, useState } from 'react';
import { serviceService, reviewService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const StarDisplay = ({ rating }) => {
    return (
        <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map(star => (
                <span key={star} className={`text-lg ${star <= Math.round(rating) ? 'text-yellow-400' : 'text-gray-300'}`}>
                    ★
                </span>
            ))}
        </div>
    );
};

const ServiceCard = ({ service, user, navigate }) => {
    const [reviews, setReviews] = useState([]);
    const [avgRating, setAvgRating] = useState(null);
    const [showReviews, setShowReviews] = useState(false);
    const [loadingReviews, setLoadingReviews] = useState(false);

    const fetchReviews = async () => {
        if (reviews.length > 0) {
            setShowReviews(!showReviews);
            return;
        }
        setLoadingReviews(true);
        try {
            const res = await reviewService.getServiceReviews(service._id);
            setReviews(res.data.data);
            setAvgRating(res.data.avgRating);
            setShowReviews(true);
        } catch {
            // silently fail
        } finally {
            setLoadingReviews(false);
        }
    };

    return (
        <div className="bg-white rounded-lg shadow-lg overflow-hidden hover:shadow-xl transition flex flex-col">
            {service.image && (
                <img src={service.image} alt={service.name} className="w-full h-48 object-cover" />
            )}
            <div className="p-6 flex flex-col flex-1">
                <h3 className="text-xl font-bold text-gray-800 mb-2">{service.name}</h3>
                <p className="text-gray-600 mb-4 flex-1">{service.description}</p>

                <div className="flex justify-between items-center mb-4">
                    <span className="text-2xl font-bold text-yellow-400">${service.price}</span>
                    <span className="text-sm text-gray-500">{service.duration} min</span>
                </div>

                {/* Reviews toggle */}
                <button
                    onClick={fetchReviews}
                    className="text-sm text-gray-500 hover:text-yellow-600 font-semibold mb-3 text-left transition"
                >
                    {loadingReviews
                        ? 'Loading reviews...'
                        : showReviews
                            ? '▲ Hide Reviews'
                            : `▼ Show Reviews${avgRating ? ` (${avgRating} ★)` : ''}`}
                </button>

                {showReviews && (
                    <div className="border-t border-gray-100 pt-3 space-y-3 mb-4 max-h-48 overflow-y-auto">
                        {reviews.length === 0 ? (
                            <p className="text-gray-400 text-sm">No reviews yet — be the first!</p>
                        ) : (
                            reviews.map(review => (
                                <div key={review._id} className="text-sm">
                                    <div className="flex items-center justify-between">
                                        <span className="font-semibold text-gray-700">{review.customer?.name}</span>
                                        <StarDisplay rating={review.rating} />
                                    </div>
                                    <p className="text-gray-500 mt-0.5">{review.comment}</p>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {user && user.role === 'customer' && (
                    <button
                        onClick={() => navigate('/book-appointment')}
                        className="w-full bg-yellow-400 text-black font-bold py-2 rounded-lg hover:bg-yellow-500 transition mt-auto"
                    >
                        Book Now
                    </button>
                )}
            </div>
        </div>
    );
};

const Services = () => {
    const [services, setServices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const { user } = useAuthContext();
    const navigate = useNavigate();

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

    if (loading) return <div className="text-center py-20">Loading services...</div>;

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
                    <ServiceCard
                        key={service._id}
                        service={service}
                        user={user}
                        navigate={navigate}
                    />
                ))}
            </div>
        </div>
    );
};

export default Services;