/**
 * Cloudinary can resize and compress on the fly. For our own Cloudinary links this returns a small, auto-format
 * (WebP/AVIF where supported) version cropped to a 5:3 card; any other link is returned unchanged.
 */
export function cardImage(url: string, width = 640): string {
  const marker = "/image/upload/";
  if (!url.includes("res.cloudinary.com/") || !url.includes(marker)) return url;
  const [head, tail] = [url.slice(0, url.indexOf(marker) + marker.length), url.slice(url.indexOf(marker) + marker.length)];
  if (/^(?:[a-z]{1,3}_[^/,]+,?)+\//.test(tail)) return url; // already has a transformation
  return `${head}f_auto,q_auto,c_fill,g_auto,w_${width},h_${Math.round(width * 0.6)}/${tail}`;
}
