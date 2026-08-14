/* news-ticker.js: homepage news-ticker banner (2026-08-13 feature). Fetches
 * data/news_ticker.json (Szeged365 articles the scraper determined are NOT
 * a tram accident -- see src/villamos/news_ticker.py) and renders a
 * scrolling row of clickable headlines. Same dual CommonJS/`window` export
 * pattern as stats-common.js/dom-safety.js (AUDIT.md #15), so the pure
 * render function is unit-testable under Node without a DOM. Titles/URLs
 * come from a scraped external source and are untrusted -- always routed
 * through window.VillamosSafe (dom-safety.js), never trusted directly. */
(function (global) {
  "use strict";

  function tickerItemHtml(item, safe) {
    return (
      '<a class="news-ticker-item" href="' +
      safe.safeUrl(item.url) +
      '" target="_blank" rel="noopener">' +
      safe.escapeHtml(item.title) +
      "</a>"
    );
  }

  function renderTickerHtml(items, safe) {
    if (!items || items.length === 0) return "";
    return items
      .map(function (item) {
        return tickerItemHtml(item, safe);
      })
      .join('<span class="news-ticker-sep" aria-hidden="true">&bull;</span>');
  }

  /* PIXELS_PER_SECOND: a fix, tartalom-hosszúságtól független időtartamú
   * CSS animáció (2026-08-13-i első verzió, 40s/kör) minél több elem
   * gyűlt össze a data/news_ticker.json-ban (max. 40, lásd
   * news_ticker.DEFAULT_MAX_ITEMS), annál gyorsabban, olvashatatlanul
   * pörgött -- 2026-08-14-i felhasználói jelzés. Ehelyett az időtartamot
   * futásidőben, a ténylegesen renderelt szöveg szélességéből számoljuk,
   * állandó sebességgel -- így a görgetés tempója független attól, hány
   * hír van éppen bent. */
  var PIXELS_PER_SECOND = 55;
  var MIN_DURATION_SECONDS = 20;

  function init(doc, win, fetchFn) {
    var bar = doc.getElementById("news-ticker");
    if (!bar) return;

    fetchFn("data/news_ticker.json")
      .then(function (r) {
        if (!r.ok) throw new Error("news_ticker.json: HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        var items = (data && data.items) || [];
        if (items.length === 0) {
          bar.hidden = true;
          return;
        }
        var html = renderTickerHtml(items, win.VillamosSafe);
        var trackA = doc.getElementById("news-ticker-track-a");
        var trackB = doc.getElementById("news-ticker-track-b");
        if (!trackA || !trackB) return;
        trackA.innerHTML = html;
        trackB.innerHTML = html; // duplicate track for the seamless CSS loop
        bar.hidden = false;

        var width = trackA.scrollWidth;
        var durationSeconds = Math.max(width / PIXELS_PER_SECOND, MIN_DURATION_SECONDS);
        trackA.style.animationDuration = durationSeconds + "s";
        trackB.style.animationDuration = durationSeconds + "s";
      })
      .catch(function () {
        // Decorative banner, not core content -- fail silent (no
        // user-facing error), unlike app.js's incident-fetch error path.
        bar.hidden = true;
      });
  }

  var api = { tickerItemHtml: tickerItemHtml, renderTickerHtml: renderTickerHtml, init: init };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.VillamosNewsTicker = api;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        init(document, window, window.fetch.bind(window));
      });
    } else {
      init(document, window, window.fetch.bind(window));
    }
  }
})(typeof window !== "undefined" ? window : this);
