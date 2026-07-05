const Package = require('../models/Package');
const ClientPackage = require('../models/ClientPackage');

// ── Provider: manage packages ──────────────────────────────────────────────

exports.getMyPackages = async (req, res) => {
    try {
        const packages = await Package.find({ provider: req.user._id })
            .populate('services', 'name price duration')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: packages });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.createPackage = async (req, res) => {
    try {
        const { name, description, services, totalSessions, price, validityDays } = req.body;
        if (!name || !totalSessions || price === undefined) {
            return res.status(400).json({ success: false, message: 'name, totalSessions, and price are required' });
        }
        const pkg = await Package.create({
            provider: req.user._id,
            name, description, services: services || [],
            totalSessions, price, validityDays: validityDays || 365,
        });
        await pkg.populate('services', 'name price duration');
        res.status(201).json({ success: true, data: pkg });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.updatePackage = async (req, res) => {
    try {
        const pkg = await Package.findOneAndUpdate(
            { _id: req.params.id, provider: req.user._id },
            req.body,
            { new: true, runValidators: true }
        ).populate('services', 'name price duration');
        if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });
        res.status(200).json({ success: true, data: pkg });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.deletePackage = async (req, res) => {
    try {
        const pkg = await Package.findOneAndDelete({ _id: req.params.id, provider: req.user._id });
        if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });
        res.status(200).json({ success: true, message: 'Package deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// ── Customer: browse & purchase ────────────────────────────────────────────

exports.getProviderPackages = async (req, res) => {
    try {
        const packages = await Package.find({ provider: req.params.providerId, isActive: true })
            .populate('services', 'name price duration');
        res.status(200).json({ success: true, data: packages });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.purchasePackage = async (req, res) => {
    try {
        const pkg = await Package.findById(req.params.id);
        if (!pkg || !pkg.isActive) return res.status(404).json({ success: false, message: 'Package not found or inactive' });

        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + (pkg.validityDays || 365));

        const clientPkg = await ClientPackage.create({
            customer: req.user._id,
            package: pkg._id,
            provider: pkg.provider,
            sessionsTotal: pkg.totalSessions,
            sessionsUsed: 0,
            sessionsRemaining: pkg.totalSessions,
            purchasePrice: pkg.price,
            expiryDate,
        });

        await clientPkg.populate('package', 'name totalSessions validityDays');
        res.status(201).json({ success: true, data: clientPkg });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getMyClientPackages = async (req, res) => {
    try {
        const now = new Date();
        // Auto-expire
        await ClientPackage.updateMany(
            { customer: req.user._id, expiryDate: { $lt: now }, status: 'active' },
            { status: 'expired' }
        );

        const pkgs = await ClientPackage.find({ customer: req.user._id })
            .populate({ path: 'package', populate: { path: 'services', select: 'name' } })
            .populate('provider', 'name')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: pkgs });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Redeem one session from a client package
exports.redeemSession = async (req, res) => {
    try {
        const clientPkg = await ClientPackage.findOne({
            _id: req.params.id,
            customer: req.user._id,
            status: 'active',
        });
        if (!clientPkg) return res.status(404).json({ success: false, message: 'Active package not found' });
        if (clientPkg.sessionsRemaining <= 0) {
            return res.status(400).json({ success: false, message: 'No sessions remaining' });
        }

        clientPkg.sessionsUsed += 1;
        clientPkg.sessionsRemaining -= 1;
        if (clientPkg.sessionsRemaining === 0) clientPkg.status = 'used';
        await clientPkg.save();

        res.status(200).json({ success: true, data: clientPkg });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Provider: see which clients have purchased packages
exports.getMyPackageClients = async (req, res) => {
    try {
        const pkgs = await ClientPackage.find({ provider: req.user._id })
            .populate('customer', 'name email')
            .populate('package', 'name totalSessions price')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: pkgs });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
