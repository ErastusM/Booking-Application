// Thin re-export over @bookplus/api-client so existing call sites keep their
// import shape. The endpoint definitions live in packages/api-client.
import client from './client';

// POST /appointments/multi (provider-only "Add service" multi-service booking —
// see ProviderDashboard's New Appointment modal). Not yet ported into
// packages/api-client, so it's layered on here against the same shared axios
// instance (`client.api`) the rest of appointmentService already uses.
export const appointmentService = {
    ...client.services.appointmentService,
    createMultiAppointment: (data) => client.api.post('/appointments/multi', data),
};

export const {
    authService,
    serviceService,
    userService,
    favoriteService,
    waitingListService,
    reviewService,
    notificationService,
    analyticsService,
    earningsService,
    availabilityService,
    providerServiceService,
    providerMarketService,
    categoryService,
    blockedTimeService,
    messageService,
    clientCRMService,
    packageService,
    retentionService,
    teamService,
    myTimeOffService,
    myServicesService,
    suggestionService,
    pushService,
    walletService,
    providerWalletService,
    formService,
} = client.services;
