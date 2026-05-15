const mongoose = require('mongoose');
require('dotenv').config();
mongoose.connect(process.env.MONGODB_URI).then(async () => {
    const Appointment = require('./src/models/Appointment');
    const appointments = await Appointment.find({}).populate('provider', 'name').populate('service', 'name');
    appointments.forEach(a => console.log(a.service?.name, '| provider:', a.provider?.name || 'NULL', '| status:', a.status));
    mongoose.disconnect();
});