"use client";

import { useEffect } from "react";

// Registers the thumbnail-caching service worker (see public/sw.js) once,
// on first load. Silently does nothing on browsers/in-app webviews that
// don't support service workers — the app works fine without it, just
// without the instant-load caching.
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
