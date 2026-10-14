// The refresh token is only ever sent as an httpOnly cookie (bp_rt_c for a
// customer account, bp_rt_b for a business account), never in a JSON body.
const refreshCookieOf = (res) => {
    const c = (res.headers['set-cookie'] || []).find((v) => /^bp_rt_[cb]=[^;]/.test(v));
    return c ? decodeURIComponent(c.split(';')[0].split('=').slice(1).join('=')) : null;
};
// The browser-binding cookie a one-time sign-in code was minted with
// (utils/handoffBinding): send it back with the exchange, as the browser would.
const handoffCookieOf = (res) => {
    const c = (res.headers['set-cookie'] || []).find((v) => /^bp_ho=[^;]/.test(v));
    return c ? c.split(';')[0] : '';
};
module.exports = { refreshCookieOf, handoffCookieOf };
