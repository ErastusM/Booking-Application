// Unsigned Cloudinary upload for PUBLIC pictures (avatars, portfolio, team photos).
// Proofs of payment use the private, signed uploadProof below — never this.
import { walletService } from '../services';
const CLOUDINARY_CLOUD = 'dktit6s95';
const CLOUDINARY_PRESET = 'bookplus';

export const uploadToCloudinary = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', CLOUDINARY_PRESET);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, {
        method: 'POST',
        body: fd,
    });
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();
    return data.secure_url;
};

// Proof-of-payment upload — images AND PDFs, PRIVATE. A bank proof must never
// sit at a public URL, so it is not sent unsigned like the photos above: the API
// signs ONE upload as a Cloudinary `authenticated` asset in this user's own
// folder, the file goes straight to Cloudinary with that signature, and only its
// reference comes back. Viewing it later goes through a short-lived signed link
// (ProofLink). Returns { ref, kind } — ref is what the top-up request carries.
export const uploadProof = async (file) => {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    let params;
    try {
        params = (await walletService.proofUploadParams()).data.data;
    } catch (err) {
        // 503 = the server has no private-upload keys yet. Say so plainly; the
        // top-up still goes through with the payment reference.
        if (err?.response?.status === 503) throw new Error('Photo proofs are temporarily unavailable — add your payment reference instead.');
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
