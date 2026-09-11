const Location = require('../models/Location');

// Owner CRUD for business locations. Provider-scoped throughout: every query is
// pinned to req.user._id, so one owner can never see or touch another's
// locations. This is the FOUNDATION layer — creating/renaming locations and
// choosing the primary — ahead of any read that actually routes bookings by
// location. Exactly one location per provider is primary; a null locationId
// elsewhere resolves to it.

const shape = (loc) => ({
    _id: loc._id,
    name: loc.name,
    address: loc.address,
    isPrimary: loc.isPrimary,
    isActive: loc.isActive,
    createdAt: loc.createdAt,
    updatedAt: loc.updatedAt,
});

// List the owner's locations, primary first then newest.
exports.getMyLocations = async (req, res) => {
    try {
        const locations = await Location.find({ provider: req.user._id }).sort({ isPrimary: -1, createdAt: 1 });
        res.status(200).json({ success: true, data: locations.map(shape) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.createLocation = async (req, res) => {
    try {
        const { name, address } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'A location name is required' });

        // The very first location a provider has is necessarily the primary one
        // (a null locationId must always resolve to something). After that, new
        // locations are non-primary until the owner promotes them.
        const count = await Location.countDocuments({ provider: req.user._id });
        const location = await Location.create({
            provider: req.user._id,
            name: name.trim(),
            address: (address || '').trim(),
            isPrimary: count === 0,
            isActive: true,
        });
        res.status(201).json({ success: true, data: shape(location) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.updateLocation = async (req, res) => {
    try {
        const location = await Location.findOne({ _id: req.params.id, provider: req.user._id });
        if (!location) return res.status(404).json({ success: false, message: 'Location not found' });

        const { name, address, isActive } = req.body;
        if (name !== undefined) {
            if (!String(name).trim()) return res.status(400).json({ success: false, message: 'A location name is required' });
            location.name = String(name).trim();
        }
        if (address !== undefined) location.address = String(address || '').trim();

        // Retiring a location has two guards, because a null locationId must
        // always have a live primary to resolve to:
        //   - the PRIMARY can't be retired directly — promote another first;
        //   - the LAST active location can't be retired — a business needs one.
        if (isActive === false && location.isActive !== false) {
            if (location.isPrimary) {
                return res.status(400).json({ success: false, message: 'Make another location primary before deactivating this one.' });
            }
            const otherActive = await Location.countDocuments({ provider: req.user._id, isActive: true, _id: { $ne: location._id } });
            if (otherActive === 0) {
                return res.status(400).json({ success: false, message: 'You need at least one active location.' });
            }
            location.isActive = false;
        } else if (isActive === true) {
            location.isActive = true;
        }

        await location.save();
        res.status(200).json({ success: true, data: shape(location) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Make one location the primary; clears the flag on the others in the same
// write pass. The target must be active — a null locationId can't resolve to a
// retired place.
exports.setPrimaryLocation = async (req, res) => {
    try {
        const location = await Location.findOne({ _id: req.params.id, provider: req.user._id });
        if (!location) return res.status(404).json({ success: false, message: 'Location not found' });
        if (location.isActive === false) {
            return res.status(400).json({ success: false, message: 'Reactivate this location before making it primary.' });
        }

        await Location.updateMany(
            { provider: req.user._id, _id: { $ne: location._id } },
            { $set: { isPrimary: false } }
        );
        if (!location.isPrimary) { location.isPrimary = true; await location.save(); }

        res.status(200).json({ success: true, data: shape(location) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
