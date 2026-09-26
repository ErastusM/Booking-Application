// The short "you agree to…" lines shown where people sign up or book, so every
// path shows the Terms and Privacy Policy before the account or booking exists.
// Same inline format as the policies: **bold** and [text](/path).
//
// Where each one is used:
//   google  — under "Continue with Google" / the Google sign-in interstitial
//             (the interstitial itself is built on fix/compliance-privacy)
//   guest   — guest checkout, above Confirm (apps/customer BookAppointment)
//   invite  — a team member accepting an invitation (apps/business AcceptInvite)
//   booking — signed-in booking, above Confirm
export const CONSENT_COPY = {
    google: 'By continuing with Google you agree to our [Terms of Service](/terms) and confirm you are 16 or older. Our [Privacy Policy](/privacy-policy) explains how we use your information.',
    guest: 'By confirming you agree to our [Terms of Service](/terms), including the business’s cancellation policy shown above, and confirm you are 16 or older. We use your details as described in our [Privacy Policy](/privacy-policy) and share them with this business.',
    invite: 'By accepting you agree to the [Business Terms of Service](/terms). Our [Privacy Policy](/privacy-policy) explains how we use your information.',
    booking: 'By confirming you agree to the business’s cancellation policy shown above and our [Terms of Service](/terms).',
};
