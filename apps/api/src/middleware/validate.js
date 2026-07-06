const { body, param, validationResult } = require('express-validator');

/**
 * Middleware that checks express-validator results and returns 400 on failure.
 */
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: errors.array().map(e => e.msg).join('; '),
        });
    }
    next();
};

// ── Auth ──

const registerRules = [
    body('name')
        .trim()
        .notEmpty().withMessage('Name is required')
        .isLength({ max: 50 }).withMessage('Name cannot exceed 50 characters'),
    body('email')
        .trim()
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Please provide a valid email')
        .normalizeEmail(),
    body('password')
        .notEmpty().withMessage('Password is required')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
        .matches(/[A-Z]/).withMessage('Password must include an uppercase letter')
        .matches(/\d/).withMessage('Password must include a number')
        .matches(/[^A-Za-z0-9]/).withMessage('Password must include a special character'),
    body('phone')
        .trim()
        .notEmpty().withMessage('Phone number is required')
        .isLength({ max: 20 }).withMessage('Phone number is too long'),
    body('role')
        .optional()
        .isIn(['customer', 'provider']).withMessage('Role must be customer or provider'),
    body('providerCategory')
        .optional()
        .isString().withMessage('Provider category must be a string')
        .isLength({ max: 100 }).withMessage('Category name too long'),
    handleValidationErrors,
];

const loginRules = [
    body('email')
        .trim()
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Please provide a valid email')
        .normalizeEmail(),
    body('password')
        .notEmpty().withMessage('Password is required'),
    handleValidationErrors,
];

const updateProfileRules = [
    body('name')
        .optional()
        .trim()
        .isLength({ min: 1, max: 50 }).withMessage('Name must be 1-50 characters'),
    body('phone')
        .optional()
        .trim()
        .isLength({ max: 20 }).withMessage('Phone number is too long'),
    body('avatar')
        .optional({ values: 'null' })
        .trim()
        .isURL().withMessage('Avatar must be a valid URL'),
    body('providerCategory')
        .optional()
        .isString().withMessage('Provider category must be a string'),
    handleValidationErrors,
];

// ── Appointments ──

const createAppointmentRules = [
    body('service')
        .notEmpty().withMessage('Service is required')
        .isMongoId().withMessage('Invalid service ID'),
    body('appointmentDate')
        .notEmpty().withMessage('Appointment date is required')
        .isISO8601().withMessage('Invalid date format'),
    body('startTime')
        .notEmpty().withMessage('Start time is required')
        .matches(/^\d{2}:\d{2}$/).withMessage('Start time must be HH:MM format'),
    body('endTime')
        .notEmpty().withMessage('End time is required')
        .matches(/^\d{2}:\d{2}$/).withMessage('End time must be HH:MM format'),
    body('notes')
        .optional()
        .trim()
        .isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters'),
    body('selectedAddOns')
        .optional()
        .isArray().withMessage('Add-ons must be an array'),
    body('customerId')
        .optional({ nullable: true })
        .isMongoId().withMessage('Invalid client ID'),
    body('walkInName')
        .optional({ nullable: true })
        .trim()
        .isLength({ max: 100 }).withMessage('Client name cannot exceed 100 characters'),
    body('recurrenceType')
        .optional({ nullable: true })
        .isIn(['daily', 'weekly', 'monthly']).withMessage('Invalid recurrence type'),
    body('recurrenceInterval')
        .optional({ nullable: true })
        .isInt({ min: 1, max: 52 }).withMessage('Repeat interval must be between 1 and 52'),
    body('recurrenceEndDate')
        .optional({ nullable: true, checkFalsy: true })
        .isISO8601().withMessage('Invalid recurrence end date'),
    body('paymentMethod')
        .optional({ nullable: true })
        .isIn(['cash', 'wallet']).withMessage('Invalid payment method'),
    handleValidationErrors,
];

const updateAppointmentStatusRules = [
    param('id')
        .isMongoId().withMessage('Invalid appointment ID'),
    body('status')
        .notEmpty().withMessage('Status is required')
        .isIn(['pending', 'confirmed', 'completed', 'cancelled', 'no-show']).withMessage('Invalid status'),
    handleValidationErrors,
];

const rescheduleAppointmentRules = [
    param('id')
        .isMongoId().withMessage('Invalid appointment ID'),
    body('appointmentDate')
        .notEmpty().withMessage('Appointment date is required')
        .isISO8601().withMessage('Invalid date format'),
    body('startTime')
        .notEmpty().withMessage('Start time is required')
        .matches(/^\d{2}:\d{2}$/).withMessage('Start time must be HH:MM format'),
    handleValidationErrors,
];

const cancelAppointmentRules = [
    param('id')
        .isMongoId().withMessage('Invalid appointment ID'),
    body('cancellationReason')
        .optional()
        .trim()
        .isLength({ max: 500 }).withMessage('Cancellation reason cannot exceed 500 characters'),
    handleValidationErrors,
];

// ── Services ──

const createServiceRules = [
    body('name')
        .trim()
        .notEmpty().withMessage('Service name is required')
        .isLength({ max: 100 }).withMessage('Name cannot exceed 100 characters'),
    body('description')
        .optional()
        .trim()
        .isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters'),
    body('price')
        .notEmpty().withMessage('Price is required')
        .isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),
    body('duration')
        .notEmpty().withMessage('Duration is required')
        .isInt({ min: 1 }).withMessage('Duration must be a positive integer (minutes)'),
    body('location')
        .optional()
        .trim()
        .isLength({ max: 200 }).withMessage('Location cannot exceed 200 characters'),
    body('address')
        .optional()
        .trim()
        .isLength({ max: 200 }).withMessage('Address cannot exceed 200 characters'),
    handleValidationErrors,
];

const updateServiceRules = [
    param('id')
        .isMongoId().withMessage('Invalid service ID'),
    body('name')
        .optional()
        .trim()
        .isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters'),
    body('description')
        .optional()
        .trim()
        .isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters'),
    body('price')
        .optional()
        .isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),
    body('duration')
        .optional()
        .isInt({ min: 1 }).withMessage('Duration must be a positive integer'),
    body('isActive')
        .optional()
        .isBoolean().withMessage('isActive must be a boolean'),
    handleValidationErrors,
];

// ── Reviews ──

const createReviewRules = [
    body('appointmentId')
        .notEmpty().withMessage('Appointment ID is required')
        .isMongoId().withMessage('Invalid appointment ID'),
    body('rating')
        .notEmpty().withMessage('Rating is required')
        .isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
    body('comment')
        .trim()
        .notEmpty().withMessage('Comment is required')
        .isLength({ max: 1000 }).withMessage('Comment cannot exceed 1000 characters'),
    handleValidationErrors,
];

// ── Waiting List ──

const joinWaitingListRules = [
    body('service')
        .notEmpty().withMessage('Service is required')
        .isMongoId().withMessage('Invalid service ID'),
    body('appointmentDate')
        .notEmpty().withMessage('Appointment date is required')
        .isISO8601().withMessage('Invalid date format'),
    body('startTime')
        .notEmpty().withMessage('Start time is required')
        .matches(/^\d{2}:\d{2}$/).withMessage('Start time must be HH:MM format'),
    body('endTime')
        .notEmpty().withMessage('End time is required')
        .matches(/^\d{2}:\d{2}$/).withMessage('End time must be HH:MM format'),
    handleValidationErrors,
];

// ── OAuth code exchange ──

const exchangeCodeRules = [
    body('code')
        .notEmpty().withMessage('Code is required')
        .isHexadecimal().withMessage('Invalid code format')
        .isLength({ min: 64, max: 64 }).withMessage('Invalid code length'),
    handleValidationErrors,
];

module.exports = {
    registerRules,
    loginRules,
    updateProfileRules,
    createAppointmentRules,
    updateAppointmentStatusRules,
    rescheduleAppointmentRules,
    cancelAppointmentRules,
    createServiceRules,
    updateServiceRules,
    createReviewRules,
    joinWaitingListRules,
    exchangeCodeRules,
};
