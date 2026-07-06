const TeamMember = require('../models/TeamMember');

exports.getMyTeam = async (req, res) => {
    try {
        const members = await TeamMember.find({ provider: req.user._id }).sort({ createdAt: 1 });
        res.status(200).json({ success: true, data: members });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.addTeamMember = async (req, res) => {
    try {
        const { name, role, email, phone, color } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Name is required' });
        }
        const member = await TeamMember.create({
            provider: req.user._id,
            name: name.trim(),
            role: (role || 'Staff').trim(),
            email: (email || '').trim().toLowerCase(),
            phone: (phone || '').trim(),
            color: color || '#f03e16',
        });
        res.status(201).json({ success: true, data: member });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.updateTeamMember = async (req, res) => {
    try {
        const { name, role, email, phone, color, isActive } = req.body;
        const member = await TeamMember.findOneAndUpdate(
            { _id: req.params.id, provider: req.user._id },
            { name, role, email, phone, color, isActive },
            { new: true, runValidators: true }
        );
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });
        res.status(200).json({ success: true, data: member });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.deleteTeamMember = async (req, res) => {
    try {
        const member = await TeamMember.findOneAndDelete({ _id: req.params.id, provider: req.user._id });
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });
        res.status(200).json({ success: true, message: 'Team member removed' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
