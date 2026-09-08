// ================== Gold Fortune – Shared Frontend Config ==================
const BIN_ID = "6a9b0f99da38895dfe399c73";
const MASTER_KEY = "$2a$10$hmXdJoo8tCS.xYXR1iTV9O8YoeagMRUQmupeveyJUy.p81/e2y/7S";
const ACCESS_KEY = "$2a$10$pqInp3O8CbNngOF0Y2rFW.oI0uk/xVUoGuGjUgpwFMFgRlhY8pAGS";
const API_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

// Frontend live-sync: JSONBin is checked in the background so admin changes
// can appear on an already-open customer page without a manual refresh.
// NOTE: JSONBin does not provide browser push/websocket events, so polling is
// used as the transport. The dashboard uses a short visible-page interval and
// performs an immediate check when the tab/app becomes active again.
let gfSyncTimer = null;
let gfSyncBusy = false;
let gfSyncHandler = null;
let gfSyncInterval = 8000;
let gfSyncLastRun = 0;

async function fetchBin() {
  const res = await fetch(`${API_URL}/latest?_gf_sync=${Date.now()}`, {
    cache: "no-store",
    headers: {
      "X-Master-Key": MASTER_KEY,
      "X-Access-Key": ACCESS_KEY,
      "Cache-Control": "no-cache"
    }
  });
  if (!res.ok) throw new Error(`Failed to load data (${res.status})`);
  const json = await res.json();
  const data = json.record || {};
  data.users = Array.isArray(data.users) ? data.users : [];
  data.withdrawals = Array.isArray(data.withdrawals) ? data.withdrawals : [];
  data.paymentSubmissions = Array.isArray(data.paymentSubmissions) ? data.paymentSubmissions : [];
  data.settings = data.settings || {};
  data.products = Array.isArray(data.products) ? data.products : [];
  return data;
}

function stopFrontendSync() {
  if (gfSyncTimer) {
    clearTimeout(gfSyncTimer);
    gfSyncTimer = null;
  }
  gfSyncHandler = null;
  gfSyncBusy = false;
}

function scheduleFrontendSync(delay = gfSyncInterval) {
  if (!gfSyncHandler) return;
  clearTimeout(gfSyncTimer);
  gfSyncTimer = setTimeout(runFrontendSync, Math.max(1000, Number(delay) || gfSyncInterval));
}

async function runFrontendSync() {
  if (!gfSyncHandler) return;

  // Keep polling while the page is open, but do not waste requests while the
  // browser has suspended the tab. visibilitychange triggers an immediate run.
  if (document.hidden) {
    scheduleFrontendSync(20000);
    return;
  }
  if (gfSyncBusy) {
    scheduleFrontendSync(2000);
    return;
  }

  gfSyncBusy = true;
  gfSyncLastRun = Date.now();
  try {
    const freshData = await fetchBin();
    await gfSyncHandler(freshData);
  } catch (err) {
    console.warn("Gold Fortune live-sync temporarily unavailable", err);
  } finally {
    gfSyncBusy = false;
    scheduleFrontendSync(gfSyncInterval);
  }
}

function startFrontendSync(onUpdate, interval = 8000) {
  stopFrontendSync();
  if (typeof onUpdate !== "function") return;

  gfSyncHandler = onUpdate;
  gfSyncInterval = Math.max(3000, Number(interval) || 8000);

  // First check immediately, then continue in the background.
  runFrontendSync();

  if (!window.__gfVisibilitySyncBound) {
    window.__gfVisibilitySyncBound = true;
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && gfSyncHandler) runFrontendSync();
    });
    window.addEventListener("pageshow", function () {
      if (gfSyncHandler) runFrontendSync();
    });
    window.addEventListener("online", function () {
      if (gfSyncHandler) runFrontendSync();
    });
  }
}

// Optional public hook for pages that need an explicit immediate sync.
window.gfRunSyncNow = function () {
  return runFrontendSync();
};

async function saveBin(data) {
  const res = await fetch(API_URL, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": MASTER_KEY,
      "X-Access-Key": ACCESS_KEY
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error("Failed to save data");
  return true;
}

function generateUniqueReferralCode(users = []) {
  const used = new Set((users || []).map(u => String(u.referralCode || '').trim().toUpperCase()).filter(Boolean));
  let code = '';
  do {
    const seed = Math.random().toString(36).slice(2, 8).toUpperCase();
    code = 'GF-' + seed;
  } while (used.has(code));
  return code;
}

function makeCustomerId(users = []) {
  const used = new Set((users || []).map(u => String(u.id || '').trim().toUpperCase()).filter(Boolean));
  let id = '';
  do {
    id = 'GFU-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (used.has(id));
  return id;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function getLoggedUser() {
  try {
    const raw = localStorage.getItem("gf_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setLoggedUser(user) {
  localStorage.setItem("gf_user", JSON.stringify(user));
}

function clearLoggedUser() {
  localStorage.removeItem("gf_user");
}


// ================== Automatic Idle Logout ==================
// Authenticated customers are logged out after 2 minutes without user
// interaction. This prevents an unattended dashboard from continuously
// consuming live-sync requests and keeps the session safer on shared devices.
const GF_IDLE_LIMIT = 2 * 60 * 1000;
let gfIdleTimer = null;
let gfLastActivity = Date.now();
let gfIdleStarted = false;

function gfIsAuthenticatedPage() {
  const path = (location.pathname || "").toLowerCase();
  return !path.endsWith("login.html") && !path.endsWith("signup.html") &&
    !path.endsWith("index.html") && !!getLoggedUser();
}

function gfIdleLogout() {
  if (!getLoggedUser()) return;
  stopFrontendSync();
  clearLoggedUser();
  localStorage.removeItem("gf_user");
  sessionStorage.removeItem("gf_idle_last_activity");
  try { sessionStorage.setItem("gf_idle_logout", "1"); } catch {}
  location.replace("login.html?reason=idle");
}

function gfResetIdleTimer() {
  if (!gfIdleStarted || !gfIsAuthenticatedPage()) return;
  gfLastActivity = Date.now();
  try { sessionStorage.setItem("gf_idle_last_activity", String(gfLastActivity)); } catch {}
  clearTimeout(gfIdleTimer);
  gfIdleTimer = setTimeout(() => {
    if (Date.now() - gfLastActivity >= GF_IDLE_LIMIT) gfIdleLogout();
    else gfResetIdleTimer();
  }, GF_IDLE_LIMIT + 250);
}

function startIdleLogout() {
  if (gfIdleStarted || !gfIsAuthenticatedPage()) return;
  gfIdleStarted = true;
  const events = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel", "scroll", "click", "input", "change"];
  events.forEach(evt => window.addEventListener(evt, gfResetIdleTimer, { passive: true }));
  window.addEventListener("pageshow", gfResetIdleTimer);
  window.addEventListener("focus", gfResetIdleTimer);
  gfResetIdleTimer();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startIdleLogout, { once: true });
} else {
  startIdleLogout();
}

function togglePassword(id) {
  const input = document.getElementById(id);
  if (input) input.type = input.type === "password" ? "text" : "password";
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isInStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
}

function setupInstallBanner(opts = {}) {
  if (isInStandaloneMode()) return;
  const banner = document.getElementById("installBanner");
  const hint = document.getElementById("installHint");
  const iosBox = document.getElementById("iosInstructions");
  const installBtn = document.getElementById("installBtn");
  if (!banner || !installBtn) return;

  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (hint) hint.textContent = "Add to home screen for quick access";
    banner.classList.add("show");
  });

  if (isIos()) {
    setTimeout(() => {
      if (!isInStandaloneMode()) {
        if (hint) hint.textContent = "Tap Install for instructions";
        banner.classList.add("show");
      }
    }, 1500);
  }

  setTimeout(() => {
    if (!isInStandaloneMode() && !banner.classList.contains("show")) {
      if (hint) hint.textContent = "Add to home screen for quick access";
      banner.classList.add("show");
    }
  }, 4000);

  installBtn.addEventListener("click", async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") banner.classList.remove("show");
      deferredPrompt = null;
    } else if (isIos() && iosBox) {
      iosBox.classList.add("show");
      if (hint) hint.textContent = "Follow the steps below";
    } else {
      alert("Android: Menu → Install app\niPhone: Share → Add to Home Screen");
    }
  });
}

function hideInstallBanner() {
  const banner = document.getElementById("installBanner");
  if (banner) banner.classList.remove("show");
}

function showToast(msg, duration = 2800) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%) translateY(-80px);background:#241c0f;border:1px solid #e8c547;color:#f0e6c8;padding:12px 20px;border-radius:10px;z-index:999;opacity:0;transition:all 0.3s;font-size:0.9rem;";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = "1";
  t.style.transform = "translateX(-50%) translateY(0)";
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateX(-50%) translateY(-80px)";
  }, duration);
}

// Register frontend service worker (PWA)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

