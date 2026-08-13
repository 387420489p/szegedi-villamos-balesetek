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

  var MONTH_NAMES_HU = [
    "Január", "Február", "Március", "Április", "Május", "Június",
    "Július", "Augusztus", "Szeptember", "Október", "November", "December"
  ];

  var WEEKDAY_NAMES_HU = [
    "Vasárnap", "Hétfő", "Kedd", "Szerda", "Csütörtök", "Péntek", "Szombat"
  ];

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

  /* computeAccidentsByMonth: a `published` incidensek naptári hónaponkénti
   * (Január..December, évektől függetlenül összesítve) átlagos száma --
   * a hónap incidens-számának és az adatban előforduló évek számának
   * hányadosa. A `topMonthIndex` a legmagasabb átlagú hónapot adja. */
  function computeAccidentsByMonth(incidents) {
    var published = incidents.filter(function (i) {
      return i.status === "published";
    });

    if (published.length === 0) {
      return { empty: true };
    }

    var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var years = {};
    published.forEach(function (i) {
      var month = parseInt(i.event_date.slice(5, 7), 10) - 1;
      counts[month] += 1;
      years[i.event_date.slice(0, 4)] = true;
    });

    var yearCount = Object.keys(years).length;
    var avgs = counts.map(function (c) {
      return c / yearCount;
    });

    var topIndex = 0;
    for (var m = 1; m < 12; m++) {
      if (avgs[m] > avgs[topIndex]) topIndex = m;
    }

    return {
      empty: false,
      counts: counts,
      avgs: avgs,
      yearCount: yearCount,
      topMonthIndex: topIndex,
      topMonthName: MONTH_NAMES_HU[topIndex],
      topMonthAvg: avgs[topIndex],
      topMonthCount: counts[topIndex]
    };
  }

  /* computeAccidentsByWeekday: a `published` incidensek hét napjai
   * szerinti (Vasárnap..Szombat) eloszlása, teljes adatbázisra összesítve.
   * A dátum helyi éjfélként értelmezve (nem UTC-ként), hogy elkerüljük az
   * időzóna-eltolásból adódó napcsúszást -- lásd app.js incidentDateTime
   * hasonló megjegyzését. Az `avgs` (évi átlag naponta) ugyanazzal az
   * évszámmal oszt, mint computeAccidentsByMonth, hogy a két bontás
   * (hónap / hét napja) összemérhető legyen. */
  function computeAccidentsByWeekday(incidents) {
    var published = incidents.filter(function (i) {
      return i.status === "published";
    });

    if (published.length === 0) {
      return { empty: true };
    }

    var counts = [0, 0, 0, 0, 0, 0, 0];
    var years = {};
    published.forEach(function (i) {
      var parts = i.event_date.split("-");
      var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      counts[d.getDay()] += 1;
      years[parts[0]] = true;
    });

    var yearCount = Object.keys(years).length;
    var avgs = counts.map(function (c) {
      return c / yearCount;
    });

    var topIndex = 0;
    for (var w = 1; w < 7; w++) {
      if (counts[w] > counts[topIndex]) topIndex = w;
    }

    return {
      empty: false,
      counts: counts,
      avgs: avgs,
      yearCount: yearCount,
      total: published.length,
      topWeekdayIndex: topIndex,
      topWeekdayName: WEEKDAY_NAMES_HU[topIndex],
      topWeekdayCount: counts[topIndex],
      topWeekdayAvg: avgs[topIndex],
      topWeekdayShare: counts[topIndex] / published.length
    };
  }

  var api = {
    STATS_WINDOW_YEARS: STATS_WINDOW_YEARS,
    MONTH_NAMES_HU: MONTH_NAMES_HU,
    WEEKDAY_NAMES_HU: WEEKDAY_NAMES_HU,
    pad2: pad2,
    formatDateHu: formatDateHu,
    computeAvgDaysPerIncident: computeAvgDaysPerIncident,
    computeAccidentsByMonth: computeAccidentsByMonth,
    computeAccidentsByWeekday: computeAccidentsByWeekday
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
