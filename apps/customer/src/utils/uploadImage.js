// Unsigned Cloudinary upload, shared by avatar/portfolio/proof-of-payment uploads.
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

// Proof-of-payment upload — accepts images AND PDFs. Uses the /auto endpoint so
// Cloudinary stores each in the right resource type. Returns { url, kind }.
export const uploadProof = async (file) => {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', CLOUDINARY_PRESET);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/auto/upload`, {
        method: 'POST',
        body: fd,
    });
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();
    return { url: data.secure_url, kind: isPdf ? 'pdf' : 'image' };
};
