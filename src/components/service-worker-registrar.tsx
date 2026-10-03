"use client";

import { useEffect } from "react";

/**
 * Register the offline shell.
 *
 * Registration is deliberately deferred until `load` so it never competes with
 * the first paint, and it is wrapped so a browser without service-worker
 * support — or a hard failure on an insecure origin — is a no-op rather than an
 * exception in the console.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Offline support is an enhancement. The app is fully usable without
        // it, so a failure here must not surface as an error to the user.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}