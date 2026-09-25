// Cloudinary / Google URL helpers — request right-sized, modern-format derivatives
// so images stay crisp instead of shipping a tiny or unoptimized source.
//
// Notes:
//  - We request generous pixel widths and let the browser downscale, rather than
//    relying on `dpr_auto` (which needs Client-Hints that aren't enabled here, so
//    it silently serves 1x and looks soft on hi-DPI phones).
//  - Google OAuth avatars come through as ".../photo.jpg=s96-c" (only 96px); we
//    rewrite the size segment so they aren't blurry when shown larger.
//  - Unknown / empty URLs are returned unchanged.

const isCloudinary = (url) => typeof url === 'string' && url.includes('/image/upload/');
const isGooglePhoto = (url) => typeof url === 'string' && url.includes('googleusercontent.com');

// Google photo URLs end with a size segment like "=s96-c" (only 96px); request
// a bigger square. Append one if there's no size segment.
const upsizeGoogle = (url, size) =>
    /=s\d+(-c)?$/.test(url) ? url.replace(/=s\d+(-c)?$/, `=s${size}-c`) : `${url}=s${size}-c`;

// Landscape 4:3 crop for cover / card imagery (covers fall back to an avatar,
// which may be a Cloudinary upload OR a small Google OAuth photo).
export const cloudinaryThumb = (url, w = 800) => {
    if (isCloudinary(url)) {
        return url.replace('/image/upload/', `/image/upload/c_fill,g_auto,ar_4:3,w_${w},q_auto:good,f_auto/`);
    }
    if (isGooglePhoto(url)) return upsizeGoogle(url, w);
    return url;
};

// Feed photo — the hero image of each business card in the home feed.
//
// Portrait 4:5, anchored to the TOP. Two things this deliberately avoids:
//  - cloudinaryThumb's landscape 4:3 crop. The feed used to fetch 4:3 and then
//    let CSS crop that again into a square, so a portrait photo was cut twice:
//    first its top (the landscape crop), then its sides (the square). The URL
//    must request the exact shape the slot renders, so there is ONE crop.
//  - g_auto. Smart gravity centres on the detected subject, which in a
//    head-and-shoulders shot is the FACE, so it pulled the frame down and away
//    from the hair. For a barber, stylist or braider the haircut is the product.
//    g_north keeps the top of the frame and trims from the bottom (cape, chest),
//    which suits the close portrait shots businesses post of their work.
export const FEED_PHOTO_RATIO = '4 / 5';
export const cloudinaryFeedPhoto = (url, w = 1000) => {
    if (isCloudinary(url)) {
        return url.replace('/image/upload/', `/image/upload/c_fill,g_north,ar_4:5,w_${w},q_auto:good,f_auto/`);
    }
    if (isGooglePhoto(url)) return upsizeGoogle(url, w);
    return url;
};

// Square avatar / profile photo. Handles Cloudinary uploads and Google OAuth photos.
export const cloudinaryAvatar = (url, size = 256) => {
    if (isCloudinary(url)) {
        return url.replace('/image/upload/', `/image/upload/c_fill,g_face,ar_1:1,w_${size},q_auto:good,f_auto/`);
    }
    if (isGooglePhoto(url)) return upsizeGoogle(url, size);
    return url;
};
