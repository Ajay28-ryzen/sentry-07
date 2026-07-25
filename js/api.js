/**
 * api.js
 * Handles backend connectivity checks for SENTRY-07 dashboard.
 * Depends on the global CONFIG object defined in app.js (API_BASE, DEMO_MODE).
 */

/**
 * Pings the backend /health endpoint to confirm it's reachable.
 * Logs the result and updates the connection badge if present.
 */
async function checkBackendHealth() {
  if (typeof CONFIG === "undefined") {
    console.warn("CONFIG not found — make sure app.js loads before api.js");
    return;
  }

  if (CONFIG.DEMO_MODE) {
    logEvent("Demo mode — skipping backend health check.");
    updateConnectionBadge(false, true);
    return;
  }

  try {
    const res = await fetch(`${CONFIG.API_BASE}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000) // avoid hanging if the Pi is off/unreachable
    });

    if (!res.ok) throw new Error(`Status ${res.status}`);

    const data = await res.json();
    logEvent(`Backend reachable — ${data.service || "backend"} (${data.status})`);
    updateConnectionBadge(true);

  } catch (err) {
    logEvent(`Backend unreachable: ${err.message}`);
    updateConnectionBadge(false);
  }
}

/**
 * Updates a connection status badge in the UI, if one exists.
 * Expects an element with id="backend-status".
 * @param {boolean} isOnline
 * @param {boolean} isDemo
 */
function updateConnectionBadge(isOnline, isDemo = false) {
  const badge = document.getElementById("backend-status");
  if (!badge) return;

  if (isDemo) {
    badge.textContent = "Backend: Demo Mode";
    badge.classList.remove("status-ok", "status-error");
    badge.classList.add("status-demo");
    return;
  }

  badge.textContent = isOnline ? "Backend: Online" : "Backend: Offline";
  badge.classList.toggle("status-ok", isOnline);
  badge.classList.toggle("status-error", !isOnline);
  badge.classList.remove("status-demo");
}

/**
 * Fallback logger in case app.js hasn't defined one yet.
 * If app.js already defines logEvent, this won't override it
 * (it's only used if logEvent is undefined at call time).
 */
if (typeof logEvent === "undefined") {
  function logEvent(message) {
    console.log(`[SENTRY-07] ${message}`);
  }
}

/**
 * Starts polling the backend health endpoint at a fixed interval.
 * Call this instead of checkBackendHealth() if you want continuous
 * monitoring rather than a single check on page load.
 * @param {number} intervalMs
 */
function startHealthPolling(intervalMs = 10000) {
  checkBackendHealth();
  setInterval(checkBackendHealth, intervalMs);
}

// Run a single health check automatically once the page loads.
window.addEventListener("DOMContentLoaded", () => {
  checkBackendHealth();
});