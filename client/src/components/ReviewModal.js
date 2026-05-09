import React, { useState } from 'react';
import { reviewService } from '../services';

const StarPicker = ({ rating, onRate }) => {
    const [hovered, setHovered] = useState(0);
    return (
        <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(star => (
                <button
                    key={star}
                    type="button"
                    onClick={() => onRate(star)}
                    onMouseEnter={() => setHovered(star)}
                    onMouseLeave={() => setHovered(0)}
                    className="text-3xl transition"
                >
                    <span className={(hovered || rating) >= star ? 'text-yellow-400' : 'text-gray-300'}>
                        ★
                    </span>
                </button>
            ))}
        </div>
    );
};

const ReviewModal = ({ appointment, onClose, onSubmitted }) => {
    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (rating === 0) {
            setError('Please select a star rating');
            return;
        }
        setLoading(true);
        setError('');
        try {
            await reviewService.createReview({
                appointmentId: appointment._id,
                rating,
                comment,
            });
            onSubmitted();
            onClose();
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to submit review');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-md mx-4">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-gray-800">Leave a Review</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl font-bold">×</button>
                </div>

                <p className="text-gray-500 mb-6">
                    Reviewing: <span className="font-semibold text-gray-800">{appointment.service?.name}</span>
                </p>

                {error && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label className="block text-gray-700 font-semibold mb-2">Your Rating</label>
                        <StarPicker rating={rating} onRate={setRating} />
                    </div>

                    <div>
                        <label className="block text-gray-700 font-semibold mb-2">Your Review</label>
                        <textarea
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                            required
                            rows="4"
                            maxLength={500}
                            placeholder="Tell us about your experience..."
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                        />
                        <p className="text-xs text-gray-400 mt-1 text-right">{comment.length}/500</p>
                    </div>

                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 border border-gray-300 text-gray-600 font-bold py-2 rounded-lg hover:bg-gray-50 transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 bg-yellow-400 text-black font-bold py-2 rounded-lg hover:bg-yellow-500 transition disabled:opacity-50"
                        >
                            {loading ? 'Submitting...' : 'Submit Review'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ReviewModal;