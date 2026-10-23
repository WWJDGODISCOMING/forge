// Decode the images of a freshly drawn screen before it is shown, so a transition never reveals a half-painted
// photo. Capped so a slow image can't hold a route change: whatever isn't ready by then decodes on its own.
export function decodeImages(root, maxMs = 120) {
  const imgs = [...root.querySelectorAll('img')].filter((img) => img.src && !img.complete && typeof img.decode === 'function');
  if (!imgs.length) return Promise.resolve();
  const all = Promise.allSettled(imgs.map((img) => img.decode()));
  return Promise.race([all, new Promise((resolve) => setTimeout(resolve, maxMs))]);
}
