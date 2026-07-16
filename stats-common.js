/* stats-common.js: AUDIT.md #12 -- the "N nap / esemény, elmúlt 5 év
 * gördülő ablaka" számítás korábban két helyen, két külön implementációban
 * élt (app.js-ben a "predikció" alatt, és statisztikak.html egy beágyazott
 * <script>-jében), amik matematikailag ugyanazt csinálták, csak más
 * sorrendben osztottak -- könnyen szét tudtak volna csúszni egy jövőbeli
 * módosításnál. Ez a közös, oldal-független implementáció mindkét helyről
 * hívva van; sima <script> tag-ként töltve (nem modul), `window.VillamosStats`
 * névtér alatt, hogy statisztikak.html beágyazott, nem-modul <script>-je is
 * el tudja érni build-lépés nélkül. */
(function (global) {
  "use strict";

  var STATS_WINDOW_YEARS = 5;

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function formatDateHu(d) {
    return d.getFullYear() + "." + pad2(d.getMonth() + 1) + "." + pad2(d.getDate()) + ".";
  }

  /* computeAvgDaysPerIncident: a `published` incidensek egy gördülő
   * N-éves ablakban ("most" - N év .. "most") mért átlagos gyakorisága,
   * nap/esemény egységben. NEM évi átlag -- a teljes ablak napjainak és a
   * benne eső események számának hányadosa (lásd a felhasználónak
   * megjelenő szöveget mindkét oldalon). */
  function computeAvgDaysPerIncident(incidents, now, windowYears) {
    windowYears = windowYears || STATS_WINDOW_YEARS;
    var published = incidents.filter(function (i) {
      return i.status === "published";
    });

    var windowStart = new Date(now.getTime());
    windowStart.setFullYear(windowStart.getFullYear() - windowYears);
    var windowStartStr = windowStart.toISOString().slice(0, 10);

    var windowed = published.filter(function (i) {
      return i.event_date >= windowStartStr;
    });

    if (windowed.length === 0) {
      return { empty: true, windowStart: windowStart, windowYears: windowYears };
    }

    var avgGapMs = (now.getTime() - windowStart.getTime()) / windowed.length;

    return {
      empty: false,
      windowStart: windowStart,
      windowYears: windowYears,
      windowedCount: windowed.length,
      avgGapMs: avgGapMs,
      avgDays: avgGapMs / 86400000
    };
  }

  var api = {
    STATS_WINDOW_YEARS: STATS_WINDOW_YEARS,
    pad2: pad2,
    formatDateHu: formatDateHu,
    computeAvgDaysPerIncident: computeAvgDaysPerIncident
  };

  /* AUDIT.md #15: same dual-export pattern as dom-safety.js -- CommonJS
     when `module` exists (tests/js/, Node), otherwise window.VillamosStats
     (browsers). */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.VillamosStats = api;
  }
})(typeof window !== "undefined" ? window : this);
