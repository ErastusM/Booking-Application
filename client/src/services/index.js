// Thin re-export over @bookplus/api-client so existing call sites keep their
// import shape. The endpoint definitions live in packages/api-client.
import client from './client';

export const {
    authService,
    serviceService,
    appointmentService,
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
    suggestionService,
    pushService,
    walletService,
    providerWalletService,
    formService,
} = client.services;
