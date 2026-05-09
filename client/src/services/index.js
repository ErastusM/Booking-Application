import API from './api';

export const authService = {
    register: (userData) => API.post('/auth/register', userData),
    login: (credentials) => API.post('/auth/login', credentials),
    logout: () => API.post('/auth/logout'),
    getProfile: () => API.get('/auth/profile'),
    updateProfile: (data) => API.put('/auth/profile', data)
};

export const serviceService = {
    getAllServices: () => API.get('/services'),
    getServiceById: (id) => API.get(`/services/${id}`),
    createService: (data) => API.post('/services', data),
    updateService: (id, data) => API.put(`/services/${id}`, data),
    deleteService: (id) => API.delete(`/services/${id}`)
};

export const appointmentService = {
    getAllAppointments: () => API.get('/appointments'),
    getCustomerAppointments: () => API.get('/appointments/my-appointments'),
    createAppointment: (data) => API.post('/appointments', data),
    updateAppointment: (id, data) => API.put(`/appointments/${id}`, data),
    cancelAppointment: (id, reason) => API.post(`/appointments/${id}/cancel`, { cancellationReason: reason }),
    updateAppointmentStatus: (id, status) => API.put(`/appointments/${id}/status`, { status }),
};

export const userService = {
    getAllUsers: () => API.get('/users'),
    deleteUser: (id) => API.delete(`/users/${id}`),
    updateUserRole: (id, role) => API.put(`/users/${id}/role`, { role }),
};

export const waitingListService = {
    join: (data) => API.post('/waitinglist', data),
    getMyList: () => API.get('/waitinglist'),
    leave: (id) => API.delete(`/waitinglist/${id}`),
    getNotifications: () => API.get('/waitinglist/notifications'),
};

export const reviewService = {
    createReview: (data) => API.post('/reviews', data),
    getServiceReviews: (serviceId) => API.get(`/reviews/service/${serviceId}`),
    getMyReviews: () => API.get('/reviews/my-reviews'),
    deleteReview: (id) => API.delete(`/reviews/${id}`),
};
