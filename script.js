/* ==========================================================================
   MindMetric AI — front-end logic (vanilla JavaScript, no dependencies)

   Sections:
     1. Configuration            (edit API_BASE_URL and SCORE_SCALE here)
     2. Field definitions & validation
     3. Progress indicator
     4. API request & error handling
     5. Results display
     6. Navigation
     7. Initialisation

   Privacy: submitted values are held only in the form fields and in the one
   request sent to your own backend. Nothing is written to localStorage,
   sessionStorage, cookies or the URL, and nothing is logged to the console.
   ========================================================================== */
"use strict";

/* ==========================================================================
   1. CONFIGURATION
   ========================================================================== */

/**
 * Base URL of your deployed FastAPI backend, WITHOUT a trailing slash and
 * WITHOUT "/predict". Examples:
 *   Render:  "https://your-backend-name.onrender.com"
 *   Local:   "http://127.0.0.1:8000"
 * While this still holds the placeholder below, the form refuses to send
 * requests and shows a clear configuration message instead.
 */
const API_BASE_URL = "https://mental-health-score-predictor-e6we.onrender.com";

/** Path of the prediction endpoint on the backend. */
const PREDICT_PATH = "/predict";

/** Abort the request after this long. Free Render services can take ~1 minute to wake up. */
const REQUEST_TIMEOUT_MS = 60000;

/** Show the "backend may be waking up" hint after this long. */
const SLOW_HINT_MS = 8000;

/**
 * Optional scale for the circular score indicator.
 * The model's real output range is not known to this front end, so by default
 * the score is shown as a number inside a dashed, non-proportional ring.
 * Once you have confirmed the range (for example from the minimum and maximum
 * of the training target), set both values, e.g. { min: 0, max: 100 }.
 */
const SCORE_SCALE = { min: null, max: null };

/* ==========================================================================
   2. FIELD DEFINITIONS & VALIDATION
   Request property names are the exact snake_case names of the Pydantic model.
   ========================================================================== */

/** kind: "int" | "number" | "select". Order matches the documented JSON body. */
const FIELD_SPECS = [
  { name: "age",                     label: "age",                      kind: "int",    min: 10, max: 100, group: "personal"  },
  { name: "gender",                  label: "gender",                   kind: "select",                    group: "personal"  },
  { name: "country",                 label: "country",                  kind: "select",                    group: "personal"  },
  { name: "academic_level",          label: "academic level",           kind: "select",                    group: "personal"  },
  { name: "most_used_platform",      label: "most used platform",       kind: "select",                    group: "social"    },
  { name: "purpose_of_use",          label: "purpose of use",           kind: "select",                    group: "social"    },
  { name: "avg_daily_usage_hours",   label: "average daily usage",      kind: "number", min: 0,  max: 24,  group: "social"    },
  { name: "daily_unlocks",           label: "daily unlocks",            kind: "int",    min: 0,             group: "social"    },
  { name: "study_hours",             label: "study hours",              kind: "number", min: 0,  max: 24,  group: "lifestyle" },
  { name: "physical_activity_hours", label: "physical activity hours",  kind: "number", min: 0,  max: 24,  group: "lifestyle" },
  { name: "sleep_hours_per_night",   label: "sleep hours",              kind: "number", min: 0,  max: 24,  group: "lifestyle" },
  { name: "stress_level",            label: "stress level",             kind: "select",                    group: "stress"    },
];
const LIFESTYLE_FIELDS = ["study_hours", "physical_activity_hours", "sleep_hours_per_night"];

/* ---- Small DOM helpers ---- */
const $ = (selector, root = document) => root.querySelector(selector);
const fieldEl = (name) => document.getElementById(`f-${name}`);
const errorEl = (name) => document.getElementById(`err-${name}`);
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const form = $("#predict-form");
const submitBtn = $("#submit-btn");
const resetBtn = $("#reset-btn");
const touched = new Set();   // fields the user has interacted with (controls when live errors appear)
let isSubmitting = false;

/**
 * Check one field. Returns an error message, or "" when valid.
 * Pure function: it does not touch the DOM besides reading the value.
 */
function getFieldError(spec) {
  const el = fieldEl(spec.name);
  const raw = el.value.trim();

  if (spec.kind === "select") {
    if (raw === "") return `Please select your ${spec.label}.`;
    const allowed = Array.from(el.options).map((o) => o.value).filter(Boolean);
    return allowed.includes(raw) ? "" : `Please choose one of the listed options for ${spec.label}.`;
  }

  if (raw === "") return `Please enter your ${spec.label}.`;
  const value = Number(raw);
  if (!Number.isFinite(value)) return "Enter a valid number.";
  if (spec.kind === "int" && !Number.isInteger(value)) return "Use a whole number, without decimals.";
  if (spec.min !== undefined && value < spec.min) return `Must be at least ${spec.min}.`;
  if (spec.max !== undefined && value > spec.max) return `Must be ${spec.max} or less.`;
  return "";
}

/** Study + activity + sleep cannot exceed the 24 hours in a day. Returns a message or "". */
function getLifestyleError() {
  const specs = LIFESTYLE_FIELDS.map((n) => FIELD_SPECS.find((s) => s.name === n));
  if (specs.some((s) => getFieldError(s) !== "")) return "";   // wait until each field is individually valid
  const total = specs.reduce((sum, s) => sum + Number(fieldEl(s.name).value), 0);
  return total > 24
    ? `Study, physical activity and sleep add up to ${total} hours, which is more than a day has. Please adjust these values.`
    : "";
}

/** Show or clear the error for one field. */
function setFieldError(name, message) {
  const el = fieldEl(name);
  const out = errorEl(name);
  out.textContent = message;
  if (message) el.setAttribute("aria-invalid", "true");
  else el.removeAttribute("aria-invalid");
}

function setLifestyleError(message) {
  $("#err-lifestyle").textContent = message;
  LIFESTYLE_FIELDS.forEach((n) => {
    const el = fieldEl(n);
    if (message) el.setAttribute("aria-invalid", "true");
    else if (getFieldError(FIELD_SPECS.find((s) => s.name === n)) === "") el.removeAttribute("aria-invalid");
  });
}

/** Validate every field and render the errors. Returns the list of invalid field names. */
function validateAll() {
  const invalid = [];
  FIELD_SPECS.forEach((spec) => {
    const message = getFieldError(spec);
    setFieldError(spec.name, message);
    if (message) invalid.push(spec.name);
  });
  const lifestyleMessage = getLifestyleError();
  setLifestyleError(lifestyleMessage);
  if (lifestyleMessage) invalid.push(LIFESTYLE_FIELDS[0]);
  return invalid;
}

/** Build the request body using the exact property names and types the Pydantic model expects. */
function buildPayload() {
  const payload = {};
  
  // Map lowercase frontend names to the exact Capitalized names the FastAPI backend expects
  const backendKeys = {
    "age": "Age",
    "gender": "Gender",
    "country": "Country",
    "academic_level": "Academic_Level",
    "most_used_platform": "Most_Used_Platform",
    "purpose_of_use": "Purpose_Of_Use",
    "avg_daily_usage_hours": "Avg_Daily_Usage_Hours",
    "daily_unlocks": "Daily_Unlocks",
    "study_hours": "Study_Hours",
    "physical_activity_hours": "Physical_Activity_Hours",
    "sleep_hours_per_night": "Sleep_Hours_Per_Night",
    "stress_level": "Stress_Level"
  };

  FIELD_SPECS.forEach((spec) => {
    const raw = fieldEl(spec.name).value.trim();
    // Use the mapped capitalized key for the payload
    const backendKey = backendKeys[spec.name];
    payload[backendKey] = spec.kind === "select" ? raw : Number(raw);
  });
  
  return payload;
}

/** Live validation: validate on blur; once a field shows an error, re-check as the user types. */
function handleFieldEvent(event) {
  const target = event.target;
  const spec = FIELD_SPECS.find((s) => fieldEl(s.name) === target);
  if (!spec) return;
  if (event.type === "focusout") touched.add(spec.name);
  if (touched.has(spec.name) || target.hasAttribute("aria-invalid")) {
    setFieldError(spec.name, getFieldError(spec));
  }
  if (LIFESTYLE_FIELDS.includes(spec.name) && (touched.has(spec.name) || $("#err-lifestyle").textContent)) {
    setLifestyleError(getLifestyleError());
  }
  updateProgress();
}

/* ==========================================================================
   3. PROGRESS INDICATOR
   ========================================================================== */

function updateProgress() {
  const completeByGroup = {};
  let complete = 0;
  FIELD_SPECS.forEach((spec) => {
    const ok = getFieldError(spec) === "";
    if (ok) complete += 1;
    completeByGroup[spec.group] = (completeByGroup[spec.group] ?? true) && ok;
  });

  const total = FIELD_SPECS.length;
  $("#progress-fill").style.width = `${(complete / total) * 100}%`;
  $("#progress-count").textContent = `${complete} of ${total} complete`;
  const bar = $(".bar");
  bar.setAttribute("aria-valuenow", String(complete));
  bar.setAttribute("aria-valuetext", `${complete} of ${total} fields complete`);

  document.querySelectorAll(".progress-steps a").forEach((link) => {
    link.classList.toggle("is-complete", Boolean(completeByGroup[link.dataset.group]));
  });
}

/* Keep the usage slider and its number input in sync. */
function initUsageSlider() {
  const slider = $("#usage-slider");
  const input = fieldEl("avg_daily_usage_hours");
  slider.addEventListener("input", () => {
    input.value = slider.value;
    touched.add("avg_daily_usage_hours");
    setFieldError("avg_daily_usage_hours", getFieldError(FIELD_SPECS.find((s) => s.name === "avg_daily_usage_hours")));
    updateProgress();
  });
  input.addEventListener("input", () => {
    const n = Number(input.value);
    slider.value = input.value !== "" && Number.isFinite(n) ? Math.min(24, Math.max(0, n)) : 0;
  });
}

/* ==========================================================================
   4. API REQUEST & ERROR HANDLING
   ========================================================================== */

function isApiConfigured() {
  const base = String(API_BASE_URL || "").trim();
  return base !== "" && base !== "YOUR_RENDER_BACKEND_URL" && /^https?:\/\//i.test(base);
}

function buildApiUrl() {
  return `${String(API_BASE_URL).trim().replace(/\/+$/, "")}${PREDICT_PATH}`;
}

/** Render a friendly error banner above the form. Uses textContent only (no HTML injection). */
function showAlert(title, message, details = []) {
  const box = $("#form-alert");
  box.replaceChildren();

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "icon");
  icon.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#i-alert");
  icon.appendChild(use);

  const content = document.createElement("div");
  const h = document.createElement("h3");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = message;
  content.append(h, p);

  if (details.length) {
    const ul = document.createElement("ul");
    details.forEach((d) => {
      const li = document.createElement("li");
      li.textContent = d;
      ul.appendChild(li);
    });
    content.appendChild(ul);
  }

  box.append(icon, content);
  box.hidden = false;
  box.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
  box.focus({ preventScroll: true });
}

function hideAlert() {
  const box = $("#form-alert");
  box.hidden = true;
  box.replaceChildren();
}

/** Toggle every visual and functional part of the "request running" state. */
function setLoading(loading) {
  isSubmitting = loading;
  submitBtn.disabled = loading;
  resetBtn.disabled = loading;
  submitBtn.classList.toggle("is-busy", loading);
  $(".btn-label", submitBtn).textContent = loading ? "Analyzing..." : "Predict My Score";
  form.setAttribute("aria-busy", String(loading));
  $("#loading").hidden = !loading;
  $("#loading-slow").hidden = true;
  $("#form-body").toggleAttribute("inert", loading);
}

/** Pydantic 422 responses look like { detail: [{ loc: ["body", "age"], msg: "..." }, ...] }. */
function handleValidationResponse(body) {
  const messages = [];
  if (body && Array.isArray(body.detail)) {
    body.detail.slice(0, 8).forEach((item) => {
      const loc = Array.isArray(item.loc) ? item.loc : [];
      const name = String(loc[loc.length - 1] ?? "");
      const msg = typeof item.msg === "string" ? item.msg.slice(0, 120) : "Invalid value";
      const spec = FIELD_SPECS.find((s) => s.name === name);
      if (spec) {
        setFieldError(name, `The server rejected this value: ${msg}`);
        messages.push(`${spec.label.charAt(0).toUpperCase()}${spec.label.slice(1)}: ${msg}`);
      } else {
        messages.push(msg);
      }
    });
  }
  showAlert(
    "The server could not accept some values",
    "Please review the highlighted fields and try again. If everything looks right, the form and the backend may be out of sync (for example a field type or option list differs).",
    messages
  );
}

/** Send the request and return the numeric score. Throws an Error with a `.userFacing` object on failure. */
async function requestPrediction(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(buildApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw failure("timeout", "The request took too long",
        "The prediction service did not respond in time. If it was idle, give it a minute to wake up and try again.");
    }
    throw failure("network", "Couldn't reach the prediction service",
      "Check your internet connection and that the backend is running. If it is running, the browser may be blocking the request because the backend's CORS settings don't allow this website. See the README troubleshooting section.");
  } finally {
    clearTimeout(timer);
  }

  // Read the body safely: it may be empty or not JSON (e.g. an HTML error page from a proxy).
  let body = null;
  let bodyIsJson = true;
  try {
    body = await response.json();
  } catch (_) {
    bodyIsJson = false;
  }

  if (!response.ok) {
    if (response.status === 422) throw failure("validation", "", "", body);
    if (response.status === 404) {
      throw failure("not-found", "Prediction endpoint not found",
        "The server answered, but POST /predict does not exist at this address. Check that API_BASE_URL points to the FastAPI service.");
    }
    if (response.status === 500) {
      throw failure("server", "The model couldn't process this request",
        "The server hit an internal error while generating the prediction. Nothing was saved. Please try again; if it keeps happening, the backend logs will show the cause.");
    }
    if ([502, 503, 504].includes(response.status)) {
      throw failure("unavailable", "The prediction service is unavailable",
        "The backend is not responding right now. It may be starting up or restarting. Wait a moment and try again.");
    }
    throw failure("http", "Unexpected response from the server",
      `The server replied with status ${response.status}. Please try again later.`);
  }

  if (!bodyIsJson || body === null || typeof body !== "object") {
    throw failure("bad-json", "Unexpected response from the server",
      "The server replied successfully but not with valid JSON, so no score can be shown.");
  }
  const score = body.predicted_Mental_Score;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw failure("bad-shape", "Unexpected response from the server",
      "The response did not contain a numeric predicted_Mental_Score field, so no score can be shown.");
  }
  return score;
}

/** Create an Error carrying the message shown to the user. */
function failure(kind, title, message, body) {
  const err = new Error(kind);
  err.userFacing = { kind, title, message, body };
  return err;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (isSubmitting) return;                       // block duplicate submissions
  hideAlert();

  const invalid = validateAll();
  if (invalid.length) {
    FIELD_SPECS.forEach((s) => touched.add(s.name));
    showAlert(
      invalid.length === 1 ? "One field needs attention" : `${invalid.length} fields need attention`,
      "Please correct the highlighted fields and try again."
    );
    const first = fieldEl(invalid[0]);
    first.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    first.focus({ preventScroll: true });
    return;
  }

  if (!isApiConfigured()) {
    showAlert(
      "Backend URL is not configured",
      "Set API_BASE_URL at the top of script.js to your deployed FastAPI URL (for example https://your-backend-name.onrender.com), then reload this page."
    );
    return;
  }

  const slowTimer = setTimeout(() => { $("#loading-slow").hidden = false; }, SLOW_HINT_MS);
  setLoading(true);
  try {
    const score = await requestPrediction(buildPayload());
    showResults(score);
  } catch (err) {
    const info = err && err.userFacing;
    if (info && info.kind === "validation") handleValidationResponse(info.body);
    else if (info) showAlert(info.title, info.message);
    else showAlert("Something went wrong", "An unexpected error occurred. Please try again.");
  } finally {
    clearTimeout(slowTimer);
    setLoading(false);                            // always restore the button
  }
}

/* ==========================================================================
   5. RESULTS DISPLAY
   ========================================================================== */

const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 96;     // matches r="96" in index.html

/** Number of decimals to show: as many as the backend sent, capped at 2. */
function decimalsFor(value) {
  const text = String(value);
  if (text.includes("e") || text.includes("E")) return 2;
  const fraction = text.split(".")[1];
  return Math.min(2, fraction ? fraction.length : 0);
}

function formatScore(value, decimals) {
  return value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function animateCount(el, target, decimals) {
  if (prefersReducedMotion()) { el.textContent = formatScore(target, decimals); return; }
  const duration = 1200;
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatScore(target * eased, decimals);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = formatScore(target, decimals);
  };
  requestAnimationFrame(tick);
}

function hasConfiguredScale() {
  return Number.isFinite(SCORE_SCALE.min) && Number.isFinite(SCORE_SCALE.max) && SCORE_SCALE.max > SCORE_SCALE.min;
}

function showResults(score) {
  const section = $("#results");
  const card = $(".result-card", section);
  const gauge = $("#gauge");
  const fill = $("#gauge-fill");
  const decimals = decimalsFor(score);

  // Exact value, shown only if rounding to 2 decimals hides digits the backend sent.
  const exact = $("#score-exact");
  const hidesDigits = Number(score.toFixed(decimals)) !== score;
  exact.textContent = hidesDigits ? `Exact value returned by the model: ${score}` : "";
  exact.hidden = !hidesDigits;

  // Gauge: proportional only when a scale has been configured.
  const note = $("#scale-note");
  fill.style.strokeDashoffset = "";
  if (hasConfiguredScale()) {
    gauge.classList.remove("is-unscaled");
    const { min, max } = SCORE_SCALE;
    const fraction = Math.min(1, Math.max(0, (score - min) / (max - min)));
    fill.style.strokeDashoffset = String(GAUGE_CIRCUMFERENCE);       // start empty, then animate
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fill.style.strokeDashoffset = String(GAUGE_CIRCUMFERENCE * (1 - fraction));
    }));
    const outside = score < min || score > max;
    note.textContent = `Ring scale: ${min} to ${max}.${outside ? " This score falls outside the configured scale." : ""}`;
    gauge.setAttribute("aria-label", `Score ${formatScore(score, decimals)} on a scale from ${min} to ${max}`);
  } else {
    gauge.classList.add("is-unscaled");
    note.textContent = "The model's score range is not configured, so the dashed ring is decorative and does not represent a percentage.";
    gauge.setAttribute("aria-label", `Predicted score ${formatScore(score, decimals)}`);
  }

  section.hidden = false;
  card.classList.remove("is-revealing");
  void card.offsetWidth;                                             // restart the reveal animation
  card.classList.add("is-revealing");

  animateCount($("#score-value"), score, decimals);
  $("#score-sr").textContent = `Your predicted score is ${formatScore(score, decimals)}.`;

  section.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  $("#results-title").focus({ preventScroll: true });
}

function hideResults() { $("#results").hidden = true; }

function goToForm({ clear }) {
  hideResults();
  hideAlert();
  if (clear) form.reset();
  $("#prediction").scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  fieldEl(FIELD_SPECS[0].name).focus({ preventScroll: true });
}

/* ==========================================================================
   6. NAVIGATION
   ========================================================================== */

function initNavigation() {
  const toggle = $(".nav-toggle");
  const menu = $("#nav-menu");

  const setOpen = (open) => {
    menu.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };
  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
  menu.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu.classList.contains("is-open")) { setOpen(false); toggle.focus(); }
  });
  window.matchMedia("(min-width: 821px)").addEventListener("change", (e) => { if (e.matches) setOpen(false); });

  // Highlight the nav link for the section currently in view.
  const links = Array.from(document.querySelectorAll(".nav-links a"));
  const sections = links.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((a) => {
          if (a.getAttribute("href") === `#${entry.target.id}`) a.setAttribute("aria-current", "true");
          else a.removeAttribute("aria-current");
        });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach((s) => observer.observe(s));
  }
}

/* ==========================================================================
   7. INITIALISATION
   ========================================================================== */

function init() {
  form.addEventListener("submit", handleSubmit);
  form.addEventListener("input", handleFieldEvent);
  form.addEventListener("change", handleFieldEvent);
  form.addEventListener("focusout", handleFieldEvent);

  form.addEventListener("reset", () => {
    touched.clear();
    hideAlert();
    // Wait for the browser to clear the values, then refresh dependent UI.
    setTimeout(() => {
      FIELD_SPECS.forEach((s) => setFieldError(s.name, ""));
      setLifestyleError("");
      $("#usage-slider").value = 0;
      updateProgress();
    }, 0);
  });

  $("#predict-again").addEventListener("click", () => goToForm({ clear: true }));
  $("#back-to-form").addEventListener("click", () => goToForm({ clear: false }));

  initUsageSlider();
  initNavigation();
  updateProgress();
}

document.addEventListener("DOMContentLoaded", init);
