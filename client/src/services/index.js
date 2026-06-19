import API from './api';

export const authService = {
    register: (userData) => API.post('/auth/register', userData),
    login: (credentials) => API.post('/auth/login', credentials),
    logout: () => API.post('/auth/logout'),
    getProfile: () => API.get('/auth/profile'),
    updateProfile: (data) => API.put('/auth/profile', data),
    updatePortfolio: (data) => API.put('/auth/portfolio', data),
    completeProviderSetup: (data) => API.post('/auth/provider-setup', data),
    becomeProvider: (data) => API.put('/auth/become-provider', data),
    changePassword: (data) => API.put('/auth/change-password', data),
    resendVerification: (email) => API.post('/auth/resend-verification', { email }),
    forgotPassword: (email) => API.post('/auth/forgot-password', { email }),
    resetPassword: (data) => API.post('/auth/reset-password', data),
    deactivateAccount: () => API.post('/auth/deactivate'),
    deleteAccount: (password) => API.delete('/auth/account', { data: { password } }),
    getBlockedUsers: () => API.get('/auth/blocked-users'),
    blockUser: (userId) => API.post('/auth/block', { userId }),
    unblockUser: (userId) => API.delete(`/auth/block/${userId}`),
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
    getByToken: (token) => API.get(`/appointments/manage/${token}`),
    cancelByToken: (token) => API.post(`/appointments/manage/${token}/cancel`),
    rescheduleByToken: (token, data) => API.post(`/appointments/manage/${token}/reschedule`, data),
};

export const userService = {
    getAllUsers: (params) => API.get('/users', { params }),
    deleteUser: (id) => API.delete(`/users/${id}`),
    updateUserRole: (id, role) => API.put(`/users/${id}/role`, { role }),
    toggleUserActive: (id) => API.put(`/users/${id}/active`),
};

export const favoriteService = {
    list: () => API.get('/users/favorites'),
    toggle: (providerId) => API.put(`/users/favorites/${providerId}`),
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
    getProviderAnalytics: (params) => API.get('/analytics/provider', { params }),
};

export const earningsService = {
    getMyEarnings: (params) => API.get('/earnings', { params }),
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

export const pushService = {
    getPublicKey: () => API.get('/push/vapid-public-key'),
    subscribe: (subscription) => API.post('/push/subscribe', subscription),
    unsubscribe: (endpoint) => API.post('/push/unsubscribe', { endpoint }),
};

export const walletService = {
    // Client
    getMyWallets: () => API.get('/wallet/mine'),
    getMyWalletWithProvider: (providerId) => API.get(`/wallet/mine/${providerId}`),
    topUp: (data) => API.post('/wallet/topup', data),
    getMyTransactions: (providerId) => API.get('/wallet/transactions', { params: providerId ? { providerId } : {} }),
    getMyPendingAdjustments: () => API.get('/wallet/adjustments/pending'),
    approveAdjustment: (id) => API.post(`/wallet/adjustments/${id}/approve`),
    rejectAdjustment: (id) => API.post(`/wallet/adjustments/${id}/reject`),
    // Provider
    getProviderSummary: () => API.get('/wallet/provider/summary'),
    getProviderWallets: () => API.get('/wallet/provider/wallets'),
    getProviderTopups: (status) => API.get('/wallet/provider/topups', { params: status ? { status } : {} }),
    approveTopUp: (id) => API.post(`/wallet/topups/${id}/approve`),
    rejectTopUp: (id, reason) => API.post(`/wallet/topups/${id}/reject`, { reason }),
    createAdjustment: (data) => API.post('/wallet/provider/adjustments', data),
    getProviderAdjustments: (status) => API.get('/wallet/provider/adjustments', { params: status ? { status } : {} }),
    getProviderTransactions: (customerId) => API.get('/wallet/provider/transactions', { params: customerId ? { customerId } : {} }),
    getSettings: () => API.get('/wallet/settings'),
    updateSettings: (data) => API.put('/wallet/settings', data),
    // Admin oversight of client wallet top-ups
    adminGetClientTopUps: (status) => API.get('/wallet/admin/topups', { params: status ? { status } : {} }),
    adminApproveClientTopUp: (id) => API.post(`/wallet/admin/topups/${id}/approve`),
    adminRejectClientTopUp: (id, reason) => API.post(`/wallet/admin/topups/${id}/reject`, { reason }),
};

export const providerWalletService = {
    // Provider — own platform balance
    getMyBalance: () => API.get('/provider-wallet/me'),
    submitTopUp: (data) => API.post('/provider-wallet/topup', data),
    // Admin
    getAdminSummary: () => API.get('/provider-wallet/admin/summary'),
    getAllWallets: () => API.get('/provider-wallet/admin/wallets'),
    getTopUps: (status) => API.get('/provider-wallet/admin/topups', { params: status ? { status } : {} }),
    approveTopUp: (id) => API.post(`/provider-wallet/admin/topups/${id}/approve`),
    rejectTopUp: (id, reason) => API.post(`/provider-wallet/admin/topups/${id}/reject`, { reason }),
    adjustBalance: (data) => API.post('/provider-wallet/admin/adjust', data),
    getProviderDetail: (providerId) => API.get(`/provider-wallet/admin/provider/${providerId}`),
};

export const formService = {
    // Provider
    getMyTemplates: () => API.get('/forms/templates'),
    createTemplate: (data) => API.post('/forms/templates', data),
    updateTemplate: (id, data) => API.put(`/forms/templates/${id}`, data),
    deleteTemplate: (id) => API.delete(`/forms/templates/${id}`),
    getSubmissions: (params) => API.get('/forms/submissions', { params }),
    // Customer + provider
    getFormsForAppointment: (appointmentId) => API.get(`/forms/for-appointment/${appointmentId}`),
    submitForm: (data) => API.post('/forms/submissions', data),
};