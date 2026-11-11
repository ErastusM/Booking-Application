// Sending the browser to PayGate's hosted payment page: the API opens the
// session and returns where to go and which fields to POST there. The card is
// only ever typed on PayGate's page, never on Bookplus.

/** POST `checkout.fields` to `checkout.redirectUrl` (https only). */
export const goToPayGate = (checkout, doc = document) => {
    const url = String(checkout?.redirectUrl || '');
    // The API builds this from its own settings, but the browser must never
    // be posted to anything other than an https page.
    if (!/^https:\/\//i.test(url)) throw new Error('Card payments are unavailable right now. Please try again in a few minutes.');
    const form = doc.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.style.display = 'none';
    for (const [name, value] of Object.entries(checkout.fields || {})) {
        const input = doc.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = String(value ?? '');
        form.appendChild(input);
    }
    doc.body.appendChild(form);
    form.submit();
    return form;
};
