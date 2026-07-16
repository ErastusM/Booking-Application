// ONE source of truth for how an appointment is NAMED in user-facing copy
// (in-app notifications, web push, and email), so the phrasing never drifts
// between channels.
//
// The rule: a service name is a MODIFIER, never the noun.
//   ✅ "Your “Seniors” appointment has been moved to Thu, Jul 16 at 16:00."
//   ❌ "Your Seniors was moved to Thursday, July 16 at 16:00."
// Quoting the name also stops multi-word services ("Kids Cut & Style") from
// running into the surrounding sentence, and every helper degrades gracefully
// when the service is unknown/deleted.

const quoted = (name) => `“${String(name).trim()}”`;

// Mid-sentence: "…for your “Kids” appointment"
const apptPhrase = (serviceName) =>
    (serviceName ? `your ${quoted(serviceName)} appointment` : 'your appointment');

// Sentence-initial: "Your “Kids” appointment has been cancelled."
const ApptPhrase = (serviceName) =>
    (serviceName ? `Your ${quoted(serviceName)} appointment` : 'Your appointment');

// Provider-facing, about a client's booking: "Ana cancelled their “Kids” appointment"
const theirApptPhrase = (serviceName) =>
    (serviceName ? `their ${quoted(serviceName)} appointment` : 'their appointment');

// When the SERVICE itself is the object, not the appointment:
// "You’re booked for the “Kids” service with Stark Katokele on Jul 15 at 18:00."
const servicePhrase = (serviceName) =>
    (serviceName ? `the ${quoted(serviceName)} service` : 'the service');

module.exports = { quoted, apptPhrase, ApptPhrase, theirApptPhrase, servicePhrase };
