import React, { useEffect, useState } from 'react';
import { appointmentService } from '../services';

const MyAppointments = () => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchAppointments = async () => {
      try {
        const response = await appointmentService.getCustomerAppointments();
        setAppointments(response.data.data);
      } catch (err) {
        setError('Failed to fetch appointments');
      } finally {
        setLoading(false);
      }
    };

    fetchAppointments();
  }, []);

  const handleCancel = async (appointmentId) => {
    if (window.confirm('Are you sure you want to cancel this appointment?')) {
      try {
        await appointmentService.cancelAppointment(appointmentId, 'Cancelled by customer');
        setAppointments(appointments.map(apt =>
          apt._id === appointmentId ? { ...apt, status: 'cancelled' } : apt
        ));
      } catch (err) {
        setError('Failed to cancel appointment');
      }
    }
  };

  if (loading) {
    return <div className="text-center py-20">Loading appointments...</div>;
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="text-4xl font-bold text-gray-800 mb-8">My Appointments</h1>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {appointments.length === 0 ? (
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <p className="text-gray-600 text-lg">No appointments booked yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {appointments.map(appointment => (
            <div key={appointment._id} className="bg-white rounded-lg shadow-lg p-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                <div>
                  <p className="text-gray-600 text-sm">Service</p>
                  <p className="text-lg font-semibold text-gray-800">{appointment.service?.name}</p>
                </div>

                <div>
                  <p className="text-gray-600 text-sm">Date</p>
                  <p className="text-lg font-semibold text-gray-800">
                    {new Date(appointment.appointmentDate).toLocaleDateString()}
                  </p>
                </div>

                <div>
                  <p className="text-gray-600 text-sm">Time</p>
                  <p className="text-lg font-semibold text-gray-800">
                    {appointment.startTime} - {appointment.endTime}
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-semibold ${appointment.status === 'cancelled'
                      ? 'bg-red-100 text-red-700'
                      : appointment.status === 'completed'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                      }`}
                  >
                    {appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1)}
                  </span>

                  {appointment.status !== 'cancelled' && appointment.status !== 'completed' && (
                    <button
                      onClick={() => handleCancel(appointment._id)}
                      className="text-red-600 hover:text-red-800 font-semibold text-sm"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MyAppointments;
