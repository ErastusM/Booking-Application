import { AxiosInstance } from 'axios';

// Endpoint surface ported verbatim from the pre-monorepo client
// (client/src/services/index.js). Response payloads stay untyped until the
// OpenAPI-generated types land (DUAL_APP_SPEC.md §4.1).
export const makeServices = (API: AxiosInstance, accountType?: 'customer' | 'business') => ({
    authService: {
        register: (userData: any) => API.post('/auth/register', userData),
        // The app's accountType rides along so an email that holds both a
        // customer and a business account signs in to the right one here.
        login: (credentials: any) => API.post('/auth/login', accountType ? { accountType, ...credentials } : credentials),
        logout: () => API.post('/auth/logout'),
        getProfile: () => API.get('/auth/profile'),
        updateProfile: (data: any) => API.put('/auth/profile', data),
        updatePortfolio: (data: any) => API.put('/auth/portfolio', data),
        completeProviderSetup: (data: any) => API.post('/auth/provider-setup', data),
        // Returns the provider's public booking-link handle, minting one on first call.
        generateBookingSlug: () => API.post('/auth/booking-slug'),
        becomeProvider: (data: any) => API.put('/auth/become-provider', data),
        changePassword: (data: any) => API.put('/auth/change-password', data),
        resendVerification: (email: string) => API.post('/auth/resend-verification', { email }),
        forgotPassword: (email: string) => API.post('/auth/forgot-password', accountType ? { email, accountType } : { email }),
        resetPassword: (data: any) => API.post('/auth/reset-password', data),
        deactivateAccount: () => API.post('/auth/deactivate'),
        deleteAccount: (password: string) => API.delete('/auth/account', { data: { password } }),
        getBlockedUsers: () => API.get('/auth/blocked-users'),
        blockUser: (userId: string) => API.post('/auth/block', { userId }),
        unblockUser: (userId: string) => API.delete(`/auth/block/${userId}`),
    },

    serviceService: {
        getAllServices: () => API.get('/services'),
        getServiceById: (id: string) => API.get(`/services/${id}`),
        createService: (data: any) => API.post('/services', data),
        updateService: (id: string, data: any) => API.put(`/services/${id}`, data),
        deleteService: (id: string) => API.delete(`/services/${id}`),
    },

    appointmentService: {
        getAllAppointments: (params?: any) => API.get('/appointments', { params }),
        getCustomerAppointments: () => API.get('/appointments/my-appointments'),
        getBookedSlots: (providerId: string, date: string, teamMember?: string) =>
            API.get('/appointments/booked-slots', { params: teamMember ? { providerId, date, teamMember } : { providerId, date } }),
        createAppointment: (data: any) => API.post('/appointments', data),
        updateAppointment: (id: string, data: any) => API.put(`/appointments/${id}`, data),
        cancelAppointment: (id: string, reason?: string) => API.delete(`/appointments/${id}`, { data: { cancellationReason: reason } }),
        updateAppointmentStatus: (id: string, status: string) => API.put(`/appointments/${id}/status`, { status }),
        rescheduleAppointment: (id: string, data: any) => API.put(`/appointments/${id}/reschedule`, data),
        providerRescheduleAppointment: (id: string, data: any) => API.put(`/appointments/${id}/provider-reschedule`, data),
        cancelAppointmentSeries: (id: string, deleteMode?: string) => API.delete(`/appointments/${id}/series`, { data: { deleteMode } }),
        getAppointmentHistory: (params?: any) => API.get('/appointments/history', { params }),
        createGroupBooking: (data: any) => API.post('/appointments/group', data),
        getGroupBooking: (groupId: string) => API.get(`/appointments/group/${groupId}`),
        getByToken: (token: string) => API.get(`/appointments/manage/${token}`),
        cancelByToken: (token: string) => API.post(`/appointments/manage/${token}/cancel`),
        rescheduleByToken: (token: string, data: any) => API.post(`/appointments/manage/${token}/reschedule`, data),
    },

    userService: {
        getAllUsers: (params?: any) => API.get('/users', { params }),
        deleteUser: (id: string) => API.delete(`/users/${id}`),
        updateUserRole: (id: string, role: string) => API.put(`/users/${id}/role`, { role }),
        toggleUserActive: (id: string) => API.put(`/users/${id}/active`),
    },

    favoriteService: {
        list: () => API.get('/users/favorites'),
        toggle: (providerId: string) => API.put(`/users/favorites/${providerId}`),
    },

    waitingListService: {
        join: (data: any) => API.post('/waitinglist', data),
        getMyList: () => API.get('/waitinglist'),
        getProviderList: () => API.get('/waitinglist/provider'),
        leave: (id: string) => API.delete(`/waitinglist/${id}`),
        getNotifications: () => API.get('/waitinglist/notifications'),
        // Waitlist promotions the customer hasn't been celebrated for yet + the ack.
        getPendingPromotions: () => API.get('/waitinglist/promotions/pending'),
        markPromotionCelebrated: (id: string) => API.post(`/waitinglist/promotions/${id}/celebrated`),
    },

    reviewService: {
        createReview: (data: any) => API.post('/reviews', data),
        getServiceReviews: (serviceId: string) => API.get(`/reviews/service/${serviceId}`),
        getMyReviews: () => API.get('/reviews/my-reviews'),
        getProviderReviews: () => API.get('/reviews/provider-reviews'),
        deleteReview: (id: string) => API.delete(`/reviews/${id}`),
    },

    notificationService: {
        getMyNotifications: () => API.get('/notifications'),
        markAllRead: () => API.put('/notifications/mark-all-read'),
        markOneRead: (id: string) => API.put(`/notifications/${id}/read`),
        deleteNotification: (id: string) => API.delete(`/notifications/${id}`),
    },

    analyticsService: {
        getAnalytics: () => API.get('/analytics'),
        getProviderAnalytics: (params?: any) => API.get('/analytics/provider', { params }),
        // Admin product-funnel snapshot (view→book conversion, onboarding drop-off).
        getEventFunnel: (days = 7) => API.get('/events/summary', { params: { days } }),
    },

    earningsService: {
        getMyEarnings: (params?: any) => API.get('/earnings', { params }),
    },

    availabilityService: {
        getMyAvailability: () => API.get('/availability/me'),
        updateMyAvailability: (schedule: any) => API.put('/availability/me', { schedule }),
        getProviderAvailability: (providerId: string) => API.get(`/availability/${providerId}`),
    },

    providerServiceService: {
        getMyServices: () => API.get('/services/my-services'),
        createMyService: (data: any) => API.post('/services/my-services', data),
        updateMyService: (id: string, data: any) => API.put(`/services/${id}`, data),
        deleteMyService: (id: string) => API.delete(`/services/${id}`),
        // Onboarding completeness (address/hours/services/photos/slug) for the
        // dashboard "finish setting up" reminder.
        getSetupStatus: () => API.get('/providers/me/setup-status'),
    },

    providerMarketService: {
        getAllProviders: () => API.get('/providers'),
        getProviderProfile: (id: string) => API.get(`/providers/${id}`),
        // Resolve a shareable booking-link handle to the public profile.
        getProviderBySlug: (slug: string) => API.get(`/providers/by-slug/${slug}`),
        // Bookable staff for the customer staff-selection step (public).
        getProviderStaff: (id: string, serviceId?: string) =>
            API.get(`/providers/${id}/staff`, { params: serviceId ? { serviceId } : {} }),
        // Availability-first search: providers with a real opening on `date`
        // (optionally at/after `time`, narrowed by `q`).
        searchProviders: (params: { date: string; time?: string; q?: string }) =>
            API.get('/providers/search', { params }),
    },

    categoryService: {
        getMainCategories: () => API.get('/categories/main'),
        getMyCategories: () => API.get('/categories/my-categories'),
        createCategory: (name: string) => API.post('/categories', { name }),
        updateCategory: (id: string, name: string) => API.put(`/categories/${id}`, { name }),
        deleteCategory: (id: string) => API.delete(`/categories/${id}`),
    },

    blockedTimeService: {
        getMyBlockedTimes: () => API.get('/blocked-times'),
        createBlockedTime: (data: any) => API.post('/blocked-times', data),
        updateBlockedTime: (id: string, data: any) => API.put(`/blocked-times/${id}`, data),
        deleteBlockedTime: (id: string, data?: any) => API.delete(`/blocked-times/${id}`, { data }),
    },

    messageService: {
        getConversations: () => API.get('/messages/conversations'),
        getMessages: (appointmentId: string) => API.get(`/messages/${appointmentId}`),
        sendMessage: (appointmentId: string, content: string) => API.post(`/messages/${appointmentId}`, { content }),
        getUnreadCount: () => API.get('/messages/unread-count'),
    },

    clientCRMService: {
        getMyClients: () => API.get('/crm/clients'),
        getClientDetail: (customerId: string) => API.get(`/crm/clients/${customerId}`),
        upsertClientNote: (customerId: string, data: any) => API.put(`/crm/clients/${customerId}/notes`, data),
    },

    packageService: {
        // Provider
        getMyPackages: () => API.get('/packages/my-packages'),
        createPackage: (data: any) => API.post('/packages/my-packages', data),
        updatePackage: (id: string, data: any) => API.put(`/packages/my-packages/${id}`, data),
        deletePackage: (id: string) => API.delete(`/packages/my-packages/${id}`),
        getMyPackageClients: () => API.get('/packages/my-package-clients'),
        // Customer
        getProviderPackages: (providerId: string) => API.get(`/packages/provider/${providerId}`),
        purchasePackage: (id: string) => API.post(`/packages/${id}/purchase`),
        getMyClientPackages: () => API.get('/packages/my-client-packages'),
        redeemSession: (id: string) => API.post(`/packages/my-client-packages/${id}/redeem`),
    },

    retentionService: {
        getRetentionMetrics: () => API.get('/retention'),
    },

    teamService: {
        getMyTeam: () => API.get('/team'),
        addMember: (data: any) => API.post('/team', data),
        updateMember: (id: string, data: any) => API.put(`/team/${id}`, data),
        deleteMember: (id: string) => API.delete(`/team/${id}`),
        // Epic 2 staff management
        inviteMember: (id: string, data?: any) => API.post(`/team/${id}/invite`, data || {}),
        setMemberServices: (id: string, services: string[]) => API.put(`/team/${id}/services`, { services }),
        getMemberAvailability: (id: string) => API.get(`/team/${id}/availability`),
        updateMemberAvailability: (id: string, schedule: any) => API.put(`/team/${id}/availability`, { schedule }),
    },

    suggestionService: {
        submit: (data: any) => API.post('/suggestions', data),
    },

    pushService: {
        getPublicKey: () => API.get('/push/vapid-public-key'),
        subscribe: (subscription: any) => API.post('/push/subscribe', subscription),
        unsubscribe: (endpoint: string) => API.post('/push/unsubscribe', { endpoint }),
    },

    walletService: {
        // Client
        getMyWallets: () => API.get('/wallet/mine'),
        getMyWalletWithProvider: (providerId: string) => API.get(`/wallet/mine/${providerId}`),
        topUp: (data: any) => API.post('/wallet/topup', data),
        getMyTransactions: (providerId?: string) => API.get('/wallet/transactions', { params: providerId ? { providerId } : {} }),
        getMyPendingAdjustments: () => API.get('/wallet/adjustments/pending'),
        approveAdjustment: (id: string) => API.post(`/wallet/adjustments/${id}/approve`),
        rejectAdjustment: (id: string) => API.post(`/wallet/adjustments/${id}/reject`),
        // Provider
        getProviderSummary: () => API.get('/wallet/provider/summary'),
        getProviderWallets: () => API.get('/wallet/provider/wallets'),
        getProviderTopups: (status?: string) => API.get('/wallet/provider/topups', { params: status ? { status } : {} }),
        approveTopUp: (id: string) => API.post(`/wallet/topups/${id}/approve`),
        rejectTopUp: (id: string, reason?: string) => API.post(`/wallet/topups/${id}/reject`, { reason }),
        createAdjustment: (data: any) => API.post('/wallet/provider/adjustments', data),
        getProviderAdjustments: (status?: string) => API.get('/wallet/provider/adjustments', { params: status ? { status } : {} }),
        getProviderTransactions: (customerId?: string) => API.get('/wallet/provider/transactions', { params: customerId ? { customerId } : {} }),
        getSettings: () => API.get('/wallet/settings'),
        updateSettings: (data: any) => API.put('/wallet/settings', data),
        // Admin oversight of client wallet top-ups
        adminGetClientTopUps: (status?: string) => API.get('/wallet/admin/topups', { params: status ? { status } : {} }),
        adminApproveClientTopUp: (id: string) => API.post(`/wallet/admin/topups/${id}/approve`),
        adminRejectClientTopUp: (id: string, reason?: string) => API.post(`/wallet/admin/topups/${id}/reject`, { reason }),
    },

    providerWalletService: {
        // Provider — own platform balance
        getMyBalance: () => API.get('/provider-wallet/me'),
        submitTopUp: (data: any) => API.post('/provider-wallet/topup', data),
        // Admin
        getAdminSummary: () => API.get('/provider-wallet/admin/summary'),
        getAllWallets: () => API.get('/provider-wallet/admin/wallets'),
        getTopUps: (status?: string) => API.get('/provider-wallet/admin/topups', { params: status ? { status } : {} }),
        approveTopUp: (id: string) => API.post(`/provider-wallet/admin/topups/${id}/approve`),
        rejectTopUp: (id: string, reason?: string) => API.post(`/provider-wallet/admin/topups/${id}/reject`, { reason }),
        adjustBalance: (data: any) => API.post('/provider-wallet/admin/adjust', data),
        getProviderDetail: (providerId: string) => API.get(`/provider-wallet/admin/provider/${providerId}`),
    },

    formService: {
        // Provider
        getMyTemplates: () => API.get('/forms/templates'),
        createTemplate: (data: any) => API.post('/forms/templates', data),
        updateTemplate: (id: string, data: any) => API.put(`/forms/templates/${id}`, data),
        deleteTemplate: (id: string) => API.delete(`/forms/templates/${id}`),
        getSubmissions: (params?: any) => API.get('/forms/submissions', { params }),
        // Customer + provider
        getFormsForAppointment: (appointmentId: string) => API.get(`/forms/for-appointment/${appointmentId}`),
        submitForm: (data: any) => API.post('/forms/submissions', data),
    },
});

export type BookplusServices = ReturnType<typeof makeServices>;
