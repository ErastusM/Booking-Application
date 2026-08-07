// appointmentDate is persisted as a UTC-midnight instant (e.g. "2026-08-07T00:00:00.000Z"),
// not a real moment in time — it just encodes a calendar day. Reading it back with
// `new Date(x).toLocaleDateString()` (or any local getter) re-interprets that UTC instant
// in the viewer's own timezone, which for anyone west of UTC lands on the PREVIOUS local
// day (UTC midnight is still "yesterday evening" in the Americas). `apptLocalDate` pulls
// the calendar day out via the UTC getters and rebuilds it as a local midnight Date, so
// formatting/comparing it afterwards is timezone-stable everywhere.
export const apptLocalDate = (dateInput) => {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
