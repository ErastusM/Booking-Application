// PUBLIC pictures (avatars, portfolio, team photos). The API signs each upload:
// images only, into this account's own folder, shrunk on arrival. (There used to
// be an unsigned preset here, which let anyone upload anything to the account.)
// Proofs of payment use the private uploadProof below — never this.
import { uploadService, walletService, onlinePaymentsService, financeService } from '../services';

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export const uploadToCloudinary = async (file) => {
    if (file.size > PHOTO_MAX_BYTES) throw new Error('That photo is over 10 MB.');
    let params;
    try {
        params = (await uploadService.photoParams()).data.data;
    } catch (err) {
        throw new Error(err?.response?.data?.message || 'Upload failed');
    }
    const fd = new FormData();
    fd.append('file', file);
    for (const k of ['api_key', 'timestamp', 'signature', 'folder', 'allowed_formats', 'transformation']) {
        fd.append(k, String(k === 'api_key' ? params.apiKey : params[k]));
    }
    const res = await fetch(params.uploadUrl, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();
    return data.secure_url;
};

// Private upload — images AND PDFs (proofs of payment, a business's documents).
// These must never sit at a public URL, so they are not sent unsigned like the
// photos above: the API
// signs ONE upload as a Cloudinary `authenticated` asset in this user's own
// folder, the file goes straight to Cloudinary with that signature, and only its
// reference comes back. Viewing it later goes through a short-lived signed link
// (ProofLink). Returns { ref, kind } — ref is what the API is then sent.
const uploadPrivate = async (file, getParams) => {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    let params;
    try {
        params = (await getParams()).data.data;
    } catch (err) {
        throw new Error(err?.response?.data?.message || 'Could not upload that file — try again.');
    }
    const fd = new FormData();
    fd.append('file', file);
    for (const k of ['api_key', 'timestamp', 'signature', 'type', 'folder', 'allowed_formats']) {
        fd.append(k, String(k === 'api_key' ? params.apiKey : params[k]));
    }
    const res = await fetch(params.uploadUrl, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Could not upload that file — try again.');
    const data = await res.json();
    return {
        ref: { publicId: data.public_id, resourceType: data.resource_type, format: data.format || '' },
        kind: isPdf ? 'pdf' : 'image',
    };
};

export const uploadProof = (file) => uploadPrivate(file, () => walletService.proofUploadParams());

// The documents a business sends with its online payments application (ID,
// company registration, bank letter): the same private, signed upload, into
// its own verification folder. PDF, JPG or PNG, at most 10 MB.
export const VERIFICATION_MAX_BYTES = 10 * 1024 * 1024;
export const VERIFICATION_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
export const uploadVerificationDocument = (file) => {
    if (file.size > VERIFICATION_MAX_BYTES) return Promise.reject(new Error('That file is over 10 MB. Scan it at a lower resolution, or send a PDF.'));
    if (!/\.(pdf|jpe?g|png)$/i.test(file.name || '') && !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
        return Promise.reject(new Error('Send a PDF, JPG or PNG.'));
    }
    return uploadPrivate(file, () => onlinePaymentsService.uploadParams());
};

// Evidence for a card dispute or complaint (admin, Money → Disputes): the same
// private upload, into the case's own folder. PDF, JPG or PNG, at most 10 MB.
export const uploadDisputeEvidence = (file, disputeId) => {
    if (file.size > VERIFICATION_MAX_BYTES) return Promise.reject(new Error('That file is over 10 MB.'));
    if (!/\.(pdf|jpe?g|png)$/i.test(file.name || '') && !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
        return Promise.reject(new Error('Send a PDF, JPG or PNG.'));
    }
    return uploadPrivate(file, () => financeService.disputeUploadParams(disputeId));
};
