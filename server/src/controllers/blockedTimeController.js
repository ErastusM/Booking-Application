const { randomUUID } = require('crypto');
const BlockedTime = require('../models/BlockedTime');

const MAX_OCCURRENCES = 365;

function generateOccurrences(startDate, recurrenceType, recurrenceEndDate) {
    const dates = [];
    const start = new Date(startDate + 'T00:00:00');
    const end = recurrenceEndDate
        ? new Date(recurrenceEndDate + 'T00:00:00')
        : new Date(start.getTime() + MAX_OCCURRENCES * 24 * 60 * 60 * 1000);

    let current = new Date(start);
    while (current <= end && dates.length < MAX_OCCURRENCES) {
        dates.push(current.toISOString().split('T')[0]);
        if (recurrenceType === 'daily') {
            current.setDate(current.getDate() + 1);
        } else if (recurrenceType === 'weekly') {
            current.setDate(current.getDate() + 7);
        } else if (recurrenceType === 'monthly') {
            current.setMonth(current.getMonth() + 1);
        } else {
            break;
        }
    }
    return dates;
}

exports.getMyBlockedTimes = async (req, res) => {
    try {
        const blocked = await BlockedTime.find({ provider: req.user._id })
            .sort({ date: 1, startTime: 1 });
        res.status(200).json({ success: true, data: blocked });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.createBlockedTime = async (req, res) => {
    try {
        const { date, startTime, endTime, reason, isRecurring, recurrenceType, recurrenceEndDate } = req.body;

        if (!date || !startTime || !endTime) {
            return res.status(400).json({ success: false, message: 'date, startTime and endTime are required' });
        }
        if (startTime >= endTime) {
            return res.status(400).json({ success: false, message: 'endTime must be after startTime' });
        }

        if (isRecurring && recurrenceType) {
            const groupId = randomUUID();
            const occurrences = generateOccurrences(date, recurrenceType, recurrenceEndDate);
            const docs = occurrences.map(d => ({
                provider: req.user._id,
                date: d,
                startTime,
                endTime,
                reason: reason || '',
                isRecurring: true,
                recurrenceType,
                recurrenceGroupId: groupId,
                recurrenceEndDate: recurrenceEndDate || null,
            }));
            const created = await BlockedTime.insertMany(docs);
            return res.status(201).json({ success: true, data: created });
        }

        const blocked = await BlockedTime.create({
            provider: req.user._id,
            date,
            startTime,
            endTime,
            reason: reason || '',
            isRecurring: false,
        });
        res.status(201).json({ success: true, data: blocked });
    } catch (error) {
        console.error('createBlockedTime error:', error?.message, error?.errors);
        res.status(500).json({ success: false, message: error?.message || 'Internal server error' });
    }
};

exports.updateBlockedTime = async (req, res) => {
    try {
        const { startTime, endTime, reason, updateMode } = req.body;

        const blocked = await BlockedTime.findOne({ _id: req.params.id, provider: req.user._id });
        if (!blocked) {
            return res.status(404).json({ success: false, message: 'Blocked time not found' });
        }

        const update = {};
        if (startTime !== undefined) update.startTime = startTime;
        if (endTime !== undefined) update.endTime = endTime;
        if (reason !== undefined) update.reason = reason;

        if (update.startTime && update.endTime && update.startTime >= update.endTime) {
            return res.status(400).json({ success: false, message: 'endTime must be after startTime' });
        }

        const mode = updateMode || 'this';

        if (!blocked.isRecurring || mode === 'this') {
            await BlockedTime.findByIdAndUpdate(blocked._id, update);
        } else if (mode === 'thisAndFuture') {
            await BlockedTime.updateMany(
                { recurrenceGroupId: blocked.recurrenceGroupId, date: { $gte: blocked.date } },
                update
            );
        } else if (mode === 'all') {
            await BlockedTime.updateMany(
                { recurrenceGroupId: blocked.recurrenceGroupId },
                update
            );
        }

        res.status(200).json({ success: true, message: 'Blocked time updated' });
    } catch (error) {
        console.error('updateBlockedTime error:', error?.message);
        res.status(500).json({ success: false, message: error?.message || 'Internal server error' });
    }
};

exports.deleteBlockedTime = async (req, res) => {
    try {
        const { deleteMode } = req.body;

        const blocked = await BlockedTime.findOne({ _id: req.params.id, provider: req.user._id });
        if (!blocked) {
            return res.status(404).json({ success: false, message: 'Blocked time not found' });
        }

        const mode = deleteMode || 'this';

        if (!blocked.isRecurring || mode === 'this') {
            await BlockedTime.findByIdAndDelete(blocked._id);
        } else if (mode === 'thisAndFuture') {
            await BlockedTime.deleteMany({
                recurrenceGroupId: blocked.recurrenceGroupId,
                date: { $gte: blocked.date },
            });
        } else if (mode === 'all') {
            await BlockedTime.deleteMany({ recurrenceGroupId: blocked.recurrenceGroupId });
        }

        res.status(200).json({ success: true, message: 'Blocked time deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
