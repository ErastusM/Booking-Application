import API from './api';

export const authService = {
    register: (userData) => API.post('/auth/register', userData),
    login: (credentials) => API.post('/auth/login', credentials),
    logout: () => API.post('/auth/logout'),
    getProfile: () => API.get('/auth/profile'),
    updateProfile: (data) => API.put('/auth/profile', data),
    updatePortfolio: (data) => API.put('/auth/portfolio', data),
    completeProviderSetup: (data) => API.post('/auth/provider-setup', data),
    changePassword: (data) => API.put('/auth/change-password', data),
    forgotPassword: (email) => API.post('/auth/forgot-password', { email }),
    resetPassword: (data) => API.post('/auth/reset-password', data),
};

export const serviceService = {
    getAllServices: () => API.get('/services'),
    getServiceById: (id) => API.get(`/services/${id}`),
    createService: (data) => API.post('/services', data),
    updateService: (id, data) => API.put(`/services/${id}`, data),
    deleteService: (id) => API.delete(`/services/${id}`)
};

export const appointmentService = {
    getAllAppointments: (params) => API.get('/appointments', { params }),
    getCustomerAppointments: () => API.get('/appointments/my-appointments'),
    getBookedSlots: (providerId, date) => API.get('/appointments/booked-slots', { params: { providerId, date } }),
    createAppointment: (data) => API.post('/appointments', data),
    updateAppointment: (id, data) => API.put(`/appointments/${id}`, data),
    cancelAppointment: (id, reason) => API.delete(`/appointments/${id}`, { data: { cancellationReason: reason } }),
    updateAppointmentStatus: (id, status) => API.put(`/appointments/${id}/status`, { status }),
    rescheduleAppointment: (id, data) => API.put(`/appointments/${id}/reschedule`, data),
    providerRescheduleAppointment: (id, data) => API.put(`/appointments/${id}/provider-reschedule`, data),
    cancelAppointmentSeries: (id, deleteMode) => API.delete(`/appointments/${id}/series`, { data: { deleteMode } }),
    getAppointmentHistory: (params) => API.get('/appointments/history', { params }),
    createGroupBooking: (data) => API.post('/appointments/group', data),
    getGroupBooking: (groupId) => API.get(`/appointments/group/${groupId}`),
};

export const userService = {
    getAllUsers: (params) => API.get('/users', { params }),
    deleteUser: (id) => API.delete(`/users/${id}`),
    updateUserRole: (id, role) => API.put(`/users/${id}/role`, { role }),
    toggleUserActive: (id) => API.put(`/users/${id}/active`),
};

export const waitingListService = {
    join: (data) => API.post('/waitinglist', data),
    getMyList: () => API.get('/waitinglist'),
    getProviderList: () => API.get('/waitinglist/provider'),
    leave: (id) => API.delete(`/waitinglist/${id}`),
    getNotifications: () => API.get('/waitinglist/notifications'),
};

export const reviewService = {
    createReview: (data) => API.post('/reviews', data),
    getServiceReviews: (serviceId) => API.get(`/reviews/service/${serviceId}`),
    getMyReviews: () => API.get('/reviews/my-reviews'),
    getProviderReviews: () => API.get('/reviews/provider-reviews'),
    deleteReview: (id) => API.delete(`/reviews/${id}`),
};

export const notificationService = {
    getMyNotifications: () => API.get('/notifications'),
    markAllRead: () => API.put('/notifications/mark-all-read'),
    markOneRead: (id) => API.put(`/notifications/${id}/read`),
    deleteNotification: (id) => API.delete(`/notifications/${id}`),
};

export const analyticsService = {
    getAnalytics: () => API.get('/analytics'),
};

export const availabilityService = {
    getMyAvailability: () => API.get('/availability/me'),
    updateMyAvailability: (schedule) => API.put('/availability/me', { schedule }),
    getProviderAvailability: (providerId) => API.get(`/availability/${providerId}`),
};

export const providerServiceService = {
    getMyServices: () => API.get('/services/my-services'),
    createMyService: (data) => API.post('/services/my-services', data),
    updateMyService: (id, data) => API.put(`/services/${id}`, data),
    deleteMyService: (id) => API.delete(`/services/${id}`),
};

export const providerMarketService = {
    getAllProviders: () => API.get('/providers'),
    getProviderProfile: (id) => API.get(`/providers/${id}`),
};

export const categoryService = {
    getMainCategories: () => API.get('/categories/main'),
    getMyCategories: () => API.get('/categories/my-categories'),
    createCategory: (name) => API.post('/categories', { name }),
    updateCategory: (id, name) => API.put(`/categories/${id}`, { name }),
    deleteCategory: (id) => API.delete(`/categories/${id}`),
};

export const blockedTimeService = {
    getMyBlockedTimes: () => API.get('/blocked-times'),
    createBlockedTime: (data) => API.post('/blocked-times', data),
    updateBlockedTime: (id, data) => API.put(`/blocked-times/${id}`, data),
    deleteBlockedTime: (id, data) => API.delete(`/blocked-times/${id}`, { data }),
};

export const messageService = {
    getConversations: () => API.get('/messages/conversations'),
    getMessages: (appointmentId) => API.get(`/messages/${appointmentId}`),
    sendMessage: (appointmentId, content) => API.post(`/messages/${appointmentId}`, { content }),
    getUnreadCount: () => API.get('/messages/unread-count'),
};

export const clientCRMService = {
    getMyClients: () => API.get('/crm/clients'),
    getClientDetail: (customerId) => API.get(`/crm/clients/${customerId}`),
    upsertClientNote: (customerId, data) => API.put(`/crm/clients/${customerId}/notes`, data),
};

export const packageService = {
    // Provider
    getMyPackages: () => API.get('/packages/my-packages'),
    createPackage: (data) => API.post('/packages/my-packages', data),
    updatePackage: (id, data) => API.put(`/packages/my-packages/${id}`, data),
    deletePackage: (id) => API.delete(`/packages/my-packages/${id}`),
    getMyPackageClients: () => API.get('/packages/my-package-clients'),
    // Customer
    getProviderPackages: (providerId) => API.get(`/packages/provider/${providerId}`),
    purchasePackage: (id) => API.post(`/packages/${id}/purchase`),
    getMyClientPackages: () => API.get('/packages/my-client-packages'),
    redeemSession: (id) => API.post(`/packages/my-client-packages/${id}/redeem`),
};

export const retentionService = {
    getRetentionMetrics: () => API.get('/retention'),
};

export const teamService = {
    getMyTeam: () => API.get('/team'),
    addMember: (data) => API.post('/team', data),
    updateMember: (id, data) => API.put(`/team/${id}`, data),
    deleteMember: (id) => API.delete(`/team/${id}`),
};

export const suggestionService = {
    submit: (data) => API.post('/suggestions', data),
};