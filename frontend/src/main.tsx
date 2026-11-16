import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import Root from "./Root";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </React.StrictMode>,
);

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .catch(() => {
          // Service worker registration is optional.
        });
    });
  } else {
    // In development a stale worker can serve cached modules and break HMR.
    // Release it once per tab, then reload without the worker in control.
    navigator.serviceWorker
      .getRegistrations()
      .then(async (registrations) => {
        if (!registrations.length) return;
        await Promise.all(registrations.map((registration) => registration.unregister()));
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
        if (!sessionStorage.getItem("cdmento-sw-reset")) {
          sessionStorage.setItem("cdmento-sw-reset", "1");
          window.location.reload();
        }
      })
      .catch(() => {
        // Cleanup is best-effort; the dev server still works without it.
      });
  }
}
