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
