/**
 * One-off migration — safe to run on every deploy (idempotent), and it NEVER
 * fails the deploy: every outcome exits 0.
 *
 * Make existing proof-of-payment files private.
 *
 * Until now the apps uploaded bank proofs of payment unsigned, to PUBLIC
 * Cloudinary URLs, and stored that URL on the top-up (WalletTransaction.proofUrl
 * for client wallet top-ups, ProviderWalletTransaction.proofUrl for business
 * account top-ups). Anyone holding the link could open someone's bank document.
 * New proofs are uploaded as `authenticated` assets and only ever shown through
 * short-lived signed links (utils/cloudinary.js).
 *
 * For every row that still has a public proofUrl this script:
 *   1. works out the Cloudinary public id from the URL;
 *   2. switches the asset to `authenticated` delivery (Upload API "rename" with
 *      to_type, same public id) and purges the CDN copy, so the old public URL
 *      stops working;
 *   3. records the private reference on the row and clears proofUrl.
 * A row whose asset was already switched (an earlier run that died before step
 * 3) is detected and just recorded — so re-running is always safe.
 *
 * If the server has no Cloudinary credentials (CLOUDINARY_URL, or
 * CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET), nothing
 * can be moved: the rows are PRINTED instead so they can be handled by hand, and
 * the links keep working exactly as before (still visible only to the payer and
 * the business through the new proof endpoint). The deploy log only ever shows
 * row ids and counts — never a proof URL.
 *
 * Run locally:   node scripts/migrate_private_proofs.js
 * In Docker:     docker compose exec -T server node scripts/migrate_private_proofs.js
 */
const WalletTransaction = require('../src/models/WalletTransaction');
const ProviderWalletTransaction = require('../src/models/ProviderWalletTransaction');
const cloudinary = require('../src/utils/cloudinary');

const COLLECTIONS = [
    ['WalletTransaction', WalletTransaction],
    ['ProviderWalletTransaction', ProviderWalletTransaction],
];

async function migratePrivateProofs({ log = () => {} } = {}) {
    const result = { configured: cloudinary.isConfigured(), found: 0, moved: 0, alreadyPrivate: 0, skipped: [], pending: [] };
    const cfg = cloudinary.config();

    for (const [label, Model] of COLLECTIONS) {
        const rows = await Model.find({ proofUrl: { $nin: ['', null] }, 'proof.publicId': { $in: ['', null] } })
            .select('_id proofUrl proof');
        for (const row of rows) {
            result.found += 1;
            const parsed = cloudinary.parseDeliveryUrl(row.proofUrl);
            const item = { collection: label, id: String(row._id), url: row.proofUrl };

            if (!result.configured) { result.pending.push(item); continue; }
            if (!parsed || parsed.cloudName !== cfg.cloudName) {
                // Not one of our Cloudinary files (or another account) — nothing we can move.
                result.skipped.push({ ...item, reason: parsed ? 'different Cloudinary account' : 'not a Cloudinary URL' });
                continue;
            }

            const ref = {
                publicId: parsed.publicId,
                resourceType: parsed.resourceType === 'raw' ? 'raw' : 'image',
                format: parsed.format,
                deliveryType: cloudinary.PROOF_TYPE,
            };
            try {
                let ok = false;
                if (parsed.type === cloudinary.PROOF_TYPE) {
                    ok = true; // already private delivery, only the row is stale
                    result.alreadyPrivate += 1;
                } else {
                    const r = await cloudinary.makeAuthenticated({ publicId: ref.publicId, resourceType: ref.resourceType, fromType: parsed.type });
                    if (r.ok) {
                        ok = true;
                        result.moved += 1;
                    } else if (await cloudinary.assetExists({ publicId: ref.publicId, resourceType: ref.resourceType, type: cloudinary.PROOF_TYPE })) {
                        ok = true; // moved by an earlier run that died before saving
                        result.alreadyPrivate += 1;
                    } else {
                        result.skipped.push({ ...item, reason: `Cloudinary ${r.status}: ${(r.json && r.json.error && r.json.error.message) || 'rename failed'}` });
                    }
                }
                if (ok) {
                    await Model.updateOne({ _id: row._id }, { $set: { proof: ref, proofUrl: '' } });
                    log(`  private: ${label} ${row._id}`);
                }
            } catch (err) {
                result.skipped.push({ ...item, reason: err.message });
            }
        }
    }
    return result;
}

// Cloudinary error text can quote the public id; keep the log to ids and counts.
const redactReason = (reason) => String(reason || '').replace(/https?:\/\/\S+/g, '[url]').replace(/bookplus\/proofs\/\S+/g, '[file]').slice(0, 120);

/** The deploy-log lines for a run: counts and row ids, never a URL. */
function report(r) {
    const lines = [];
    if (!r.found) {
        lines.push('migrate_private_proofs: no public proofs of payment left.');
    } else if (!r.configured) {
        lines.push(`migrate_private_proofs: ${r.found} proof(s) of payment are still public, and this server has no Cloudinary credentials (CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET), so they could not be made private. Add the credentials and redeploy. Rows:`);
        r.pending.slice(0, 200).forEach((p) => lines.push(`  ${p.collection} ${p.id}`));
        if (r.pending.length > 200) lines.push(`  …and ${r.pending.length - 200} more.`);
    } else {
        lines.push(`migrate_private_proofs: ${r.moved} made private, ${r.alreadyPrivate} already private, ${r.skipped.length} could not be moved.`);
        r.skipped.slice(0, 200).forEach((p) => lines.push(`  NOT MOVED ${p.collection} ${p.id}  (${redactReason(p.reason)})`));
    }
    return lines;
}

module.exports = { migratePrivateProofs, redactReason, report };

// CLI entry point (skipped when required by tests). Always exits 0: making old
// proofs private must never block a deploy — the worst case is they stay as they
// were, and they are listed here for a manual fix.
if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.log('migrate_private_proofs: MONGODB_URI is not set — skipped.'); return; }
        await mongoose.connect(uri);
        const r = await migratePrivateProofs({ log: (l) => console.log(l) });
        report(r).forEach((l) => console.log(l));
        await mongoose.disconnect();
    })()
        .catch((err) => console.log(`migrate_private_proofs: failed (${err.message}) — proofs left as they were.`))
        .finally(() => process.exit(0));
}
