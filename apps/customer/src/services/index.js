// Thin re-export over @bookplus/api-client so existing call sites keep their
// import shape. The endpoint definitions live in packages/api-client.
import client from './client';

// CUSTOMER-side services only. The business surface (earnings, team, CRM,
// analytics, blocked time, packages, retention, provider wallet…) is
// deliberately NOT re-exported here: nothing in this app uses it, and keeping
// it out of the marketplace bundle makes the customer/business separation a
// build-time boundary instead of a convention the next feature can drift over.
export const {
    authService,
    serviceService,
    appointmentService,
    userService,
    favoriteService,
    waitingListService,
    reviewService,
    notificationService,
    availabilityService,
    providerMarketService,
    messageService,
    suggestionService,
    pushService,
    walletService,
    formService,
} = client.services;
