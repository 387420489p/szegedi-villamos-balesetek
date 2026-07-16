/* dom-safety.js: AUDIT.md M4 + #12 -- escapeHtml/safeUrl were duplicated
 * (near-identically) in both app.js and terkep.html's inline script.
 * Shared here as a plain <script> tag (no build step, no module system,
 * same pattern as stats-common.js), so there's exactly one place that
 * decides what's safe to put in an href. Also exports via CommonJS when
 * `module` exists (AUDIT.md #15), so tests/js/ can require() these pure,
 * DOM-free functions directly without a browser. */
(function (global) {
  "use strict";

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* Only http(s) URLs are ever allowed into an href -- escapeHtml alone
     does not stop a "javascript:" URL from executing on click, and source
     URLs come from AI-classified scraped articles, so they're untrusted. */
  function safeUrl(url) {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) return url;
    return "#";
  }

  var api = { escapeHtml: escapeHtml, safeUrl: safeUrl };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.VillamosSafe = api;
  }
})(typeof window !== "undefined" ? window : this);
