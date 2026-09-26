const Service = require('../models/Service');
const { bookableMembersByProvider, hasPerformer } = require('../utils/serviceOffering');

// The business a catalogue write/read acts on: the owner's own id, or a
// services:edit (High tier) staff member's employer (staffOf). Ownership checks
// and the create/list scope use this. null = detached staff (handlers 403).
const businessScope = (req) => (req.user.role === 'staff' ? req.user.staffOf || null : req.user._id);

// Only the owner (or an admin) decides what the owner performs. A services:edit
// team member manages the menu, but "what clients can book the owner for" is
// the owner's own call — the same way only a member (or the owner) sets a
// member's own services.
const mayDecideOwnerPerforms = (req) => req.user.role === 'provider' || req.user.role === 'admin';

// Public catalogue — every active service someone can actually be booked for
// (no auth, no role filter). A service only a departed team member performed
// has nobody to do it, so it is not offered to clients any more.
exports.getAllServices = async (req, res) => {
    try {
        const all = await Service.find({ isActive: true })
            .populate('provider', 'name avatar')
            .populate('createdBy', 'name')
            .sort({ createdAt: -1 });
        const providerIds = [...new Set(all.map((s) => s.provider?._id || s.provider).filter(Boolean).map(String))];
        const membersBy = await bookableMembersByProvider(providerIds);
        const services = all.filter((s) => {
            const pid = s.provider?._id || s.provider;
            if (!pid) return true; // a global (admin) service has no roster
            return hasPerformer(s, membersBy.get(String(pid)) || []);
        });

        res.status(200).json({ success: true, count: services.length, data: services });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Get provider's own services
exports.getMyServices = async (req, res) => {
    try {
        const providerId = businessScope(req);
        if (!providerId) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        const services = await Service.find({ provider: providerId })
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, count: services.length, data: services });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Admin creates a global service
exports.createService = async (req, res) => {
    try {
        const { name, description, price, duration } = req.body;

        const service = await Service.create({
            name, description, price, duration,
            createdBy: req.user._id,
            provider: null, // global
        });

        res.status(201).json({ success: true, data: service });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Sanitize provider-supplied sub-options into the schema shape
const sanitizeOptions = (options) => {
    if (!Array.isArray(options)) return undefined;
    return options
        .filter(o => o && String(o.name || '').trim() && o.price !== '' && o.duration !== '')
        .map(o => ({
            name: String(o.name).trim().slice(0, 100),
            description: String(o.description || '').trim().slice(0, 300),
            price: Math.max(0, Number(o.price) || 0),
            duration: Math.max(5, Number(o.duration) || 30),
        }));
};

// Provider creates their own service
exports.createMyService = async (req, res) => {
    try {
        const providerId = businessScope(req);
        if (!providerId) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        const { name, description, price, duration, location, address, category, options, bufferBefore, bufferAfter, ownerPerforms } = req.body;

        const service = await Service.create({
            name, description, price, duration,
            location: location || '',
            address: address || '',
            category: category || null,
            options: sanitizeOptions(options) || [],
            bufferBefore: Math.min(120, Math.max(0, Number(bufferBefore) || 0)),
            bufferAfter: Math.min(120, Math.max(0, Number(bufferAfter) || 0)),
            // The business's own menu: the owner offers it unless THEY say
            // otherwise ("Only my team does this"). Stored explicitly, never left
            // to the legacy absent-means-true reading.
            ownerPerforms: !(mayDecideOwnerPerforms(req) && ownerPerforms === false),
            createdBy: req.user._id,      // audit: the actual author (staff or owner)
            provider: providerId,          // the business the service belongs to
        });

        res.status(201).json({ success: true, data: service });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Update service — admin can update any, provider only their own
exports.updateService = async (req, res) => {
    try {
        const service = await Service.findById(req.params.id);

        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        // Ownership: admin may edit any; a provider or a services:edit staff member
        // only their OWN business's service. The old check gated on role==='provider'
        // alone, so a staff principal fell THROUGH it — key on the business (staffOf
        // for staff) so a High staff member can't edit another business's catalogue.
        if (req.user.role !== 'admin') {
            const providerId = businessScope(req);
            if (!providerId) return res.status(403).json({ success: false, message: 'No business context for this account.' });
            if (service.provider?.toString() !== providerId.toString()) {
                return res.status(403).json({ success: false, message: 'Not authorized' });
            }
        }

        const { name, description, price, duration, location, address, isActive, category, options, bufferBefore, bufferAfter, ownerPerforms } = req.body;
        const allowedUpdates = { name, description, price, duration, location, address };
        // "I offer this" — the owner's own switch. Ignored for a services:edit
        // team member, who edits the menu but doesn't decide what the owner does.
        if (typeof ownerPerforms === 'boolean' && mayDecideOwnerPerforms(req)) allowedUpdates.ownerPerforms = ownerPerforms;
        if (category !== undefined) allowedUpdates.category = category || null;
        if (options !== undefined) allowedUpdates.options = sanitizeOptions(options) || [];
        if (bufferBefore !== undefined) allowedUpdates.bufferBefore = Math.min(120, Math.max(0, Number(bufferBefore) || 0));
        if (bufferAfter !== undefined) allowedUpdates.bufferAfter = Math.min(120, Math.max(0, Number(bufferAfter) || 0));
        if (req.user.role === 'admin' && isActive !== undefined) allowedUpdates.isActive = isActive;
        Object.keys(allowedUpdates).forEach(k => allowedUpdates[k] === undefined && delete allowedUpdates[k]);

        const updated = await Service.findByIdAndUpdate(req.params.id, allowedUpdates, { new: true });
        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Delete service — admin can delete any, provider only their own
exports.deleteService = async (req, res) => {
    try {
        const service = await Service.findById(req.params.id);

        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        // Same ownership fix as updateService: staff must be checked too (they fell
        // through the old role==='provider' guard), keyed on their business.
        if (req.user.role !== 'admin') {
            const providerId = businessScope(req);
            if (!providerId) return res.status(403).json({ success: false, message: 'No business context for this account.' });
            if (service.provider?.toString() !== providerId.toString()) {
                return res.status(403).json({ success: false, message: 'Not authorized' });
            }
        }

        await Service.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'Service deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};