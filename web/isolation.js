// Finish the one-time reload before enabling file selection, so no work is lost.
export async function initializeIsolation() {
  if (globalThis.crossOriginIsolated || !('serviceWorker' in navigator) || !globalThis.isSecureContext) return;
  try {
    const marker = `joemt-isolation:${location.pathname}`;
    if (sessionStorage.getItem(marker)) return;
    const ready = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    await navigator.serviceWorker.register(new URL(`${import.meta.env.BASE_URL}isolation-sw.js`, document.baseURI), { scope: import.meta.env.BASE_URL });
    if (!navigator.serviceWorker.controller) await Promise.race([ready, new Promise(resolve => setTimeout(resolve, 5000))]);
    if (navigator.serviceWorker.controller) { sessionStorage.setItem(marker, '1'); location.reload(); await new Promise(() => {}); }
  } catch { /* H.264/AV1 remain available when service workers are blocked. */ }
}
