// Cloudinary URL helpers — request right-sized, retina-aware, modern-format
// derivatives so images stay crisp and light instead of shipping the raw upload.
// Non-Cloudinary URLs (or empty values) are returned unchanged.

const isCloudinary = (url) => typeof url === 'string' && url.includes('/image/upload/');

// Landscape-ish crop for cover/card imagery (default 4:3).
export const cloudinaryThumb = (url, w = 600, h = 450) => {
    if (!isCloudinary(url)) return url;
    return url.replace('/image/upload/', `/image/upload/c_fill,g_auto,ar_${w}:${h},w_${w},q_auto,f_auto,dpr_auto/`);
};

// Square, face-aware crop for avatars / profile photos.
export const cloudinaryAvatar = (url, size = 160) => {
    if (!isCloudinary(url)) return url;
    return url.replace('/image/upload/', `/image/upload/c_fill,g_face,ar_1:1,w_${size},q_auto,f_auto,dpr_auto/`);
};
