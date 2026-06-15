/**
 * SMTP diagnostic — shows exactly why email is or isn't sending.
 *
 *   docker compose exec server node scripts/test_email.js                 # check config + login
 *   docker compose exec server node scripts/test_email.js you@example.com # also send a test
 *
 * It prints the resolved config (password masked), verifies the SMTP login,
 * and optionally sends a real test message — surfacing the true error that the
 * app deliberately swallows so requests never fail because of email.
 */
require('dotenv').config();
const nodemailer = require('nodemailer');
const net = require('net');

// Quick TCP reachability check — tells us if the host blocks the SMTP port.
const probePort = (host, port, timeout = 7000) => new Promise((resolve) => {
    const sock = new net.Socket();
    const finish = (ok, msg) => { try { sock.destroy(); } catch (_) {} resolve({ port, ok, msg }); };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(true, 'open'));
    sock.once('timeout', () => finish(false, 'timeout — blocked by host/firewall'));
    sock.once('error', (e) => finish(false, e.code || e.message));
    sock.connect(port, host);
});

const mask = (s) => {
    if (!s) return '(NOT SET)';
    if (s.length <= 4) return `(${s.length} chars)`;
    return `${s[0]}***${s[s.length - 1]}  (${s.length} chars)`;
};

(async () => {
    const host = process.env.EMAIL_HOST || 'smtp.hostinger.com';
    const port = parseInt(process.env.EMAIL_PORT, 10) || 465;
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    console.log('\n--- Email config seen by the server ---');
    console.log('EMAIL_HOST :', host);
    console.log('EMAIL_PORT :', port, port === 465 ? '(SSL)' : '(STARTTLS)');
    console.log('EMAIL_USER :', user || '(NOT SET)');
    console.log('EMAIL_PASS :', mask(pass));

    if (!user || !pass) {
        console.error('\n❌ EMAIL_USER and/or EMAIL_PASS are not set — the app SKIPS all email.');
        console.error('   Set them in .env.production on the host, then: docker compose up -d --force-recreate server');
        process.exit(1);
    }
    if (/PASTE_|your_mailbox_password|your_hostinger_mailbox_password/.test(pass)) {
        console.error('\n❌ EMAIL_PASS is still the placeholder text. Put the real mailbox password in .env.production.');
        process.exit(1);
    }
    if (/^["'].*["']$/.test(pass)) {
        console.error('\n⚠️  EMAIL_PASS appears wrapped in quotes. In a .env file do NOT quote values —');
        console.error('    docker compose keeps the quotes as part of the password, which fails auth.');
    }

    const transporter = nodemailer.createTransport({
        host, port, secure: port === 465,
        auth: { user, pass },
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    });

    console.log('\n--- Outbound SMTP port reachability (' + host + ') ---');
    let anyOpen = false;
    for (const p of [465, 587, 25]) {
        const r = await probePort(host, p);
        if (r.ok) anyOpen = true;
        console.log(`  port ${p}: ${r.ok ? '✅ open' : '❌ ' + r.msg}`);
    }
    if (!anyOpen) {
        console.error('\n❌ Every SMTP port timed out — your VPS/host is blocking outbound mail.');
        console.error('   Ask the host to open port 587 (and 465), or use an email API/relay.');
    } else {
        console.error('\nℹ️  Use a port marked "open" above. If 587 is open but 465 is blocked,');
        console.error('   set EMAIL_PORT=587 in .env.production, then: docker compose up -d --force-recreate server');
    }

    console.log('\n--- Verifying SMTP login on the configured port (' + port + ') ---');
    try {
        await transporter.verify();
        console.log('✅ SMTP login OK — credentials and connection are good.');
    } catch (err) {
        console.error('❌ SMTP verify FAILED.');
        console.error('   message :', err && err.message);
        console.error('   code    :', err && err.code);
        console.error('   response:', err && err.response);
        console.error('\n   535 / EAUTH  → wrong username or password (use the full address info@bookplus.pro + mailbox password).');
        console.error('   ETIMEDOUT / ECONNECTION → host is blocking outbound port ' + port + '; try EMAIL_PORT=587, or open the port.');
        process.exit(1);
    }

    const to = process.argv[2];
    if (!to) {
        console.log('\nLogin works. To send a real test message:');
        console.log('   docker compose exec server node scripts/test_email.js you@example.com');
        process.exit(0);
    }

    console.log(`\n--- Sending test email to ${to} ---`);
    try {
        const info = await transporter.sendMail({
            from: `"Bookplus" <${user}>`,
            to,
            subject: 'Bookplus SMTP test',
            text: 'If you can read this, Bookplus SMTP is configured correctly.',
        });
        console.log('✅ Sent. messageId:', info.messageId);
        console.log('   response:', info.response);
    } catch (err) {
        console.error('❌ Send FAILED:', err && err.message, '| code:', err && err.code, '| response:', err && err.response);
        process.exit(1);
    }
    process.exit(0);
})();
