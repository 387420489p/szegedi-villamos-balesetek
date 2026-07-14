/* Szegedi villamosbalesetek adatbázisa — kliensoldali renderelés.
 * Nincs framework, nincs build lépés. A data/incidents.json és
 * data/meta.json fájlokat fetch-eli, kliensoldalon rendez és szűr. */
(function () {
  "use strict";

  var MODE_LABELS = { tram: "villamos", tramtrain: "tram-train" };

  var EVENT_TYPE_LABELS = {
    collision: "ütközés",
    pedestrian_hit: "gázolás",
    derailment: "kisiklás",
    rear_end: "ráfutás",
    other: "egyéb",
  };

  var OTHER_PARTY_LABELS = {
    car: "autó",
    pedestrian: "gyalogos",
    cyclist: "kerékpáros",
    motorcycle: "motoros",
    truck: "teherautó",
    bus: "busz",
    other_tram: "másik villamos",
    train: "vonat",
    other: "egyéb",
    unknown: "ismeretlen",
  };

  var INJURY_LABELS = {
    none: "nem sérült meg senki",
    minor: "könnyű sérülés",
    severe: "súlyos sérülés",
    fatal: "halálos",
    unknown: "nincs adat",
  };

  var state = {
    incidents: [],
    filters: { year: "", mode: "", text: "" },
    counterTimer: null,
  };

  var els = {};

  function stripDiacritics(s) {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function normalizeForSearch(s) {
    return stripDiacritics(String(s || "")).toLowerCase();
  }

  function eventSortKey(incident) {
    var time = incident.event_time || "00:00";
    return incident.event_date + "T" + time;
  }

  /* incidentDateTime: a Date objektum a "jelenlegi szünet" / "rekord"
   * számláló kliensoldali számításához (ARCHITECTURE.md 7.1). Az
   * event_date+"T"+event_time (vagy hiányzó event_time esetén "00:00")
   * alakú string időzóna-jelölő nélkül a böngésző helyi idejeként
   * értelmeződik — ez tudottan csak közelítés, nem forenzikus pontosságú. */
  function incidentDateTime(incident) {
    return new Date(eventSortKey(incident));
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function formatDuration(ms) {
    var totalMinutes = Math.floor(ms / 60000);
    var days = Math.floor(totalMinutes / (24 * 60));
    var hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    var minutes = totalMinutes % 60;
    return days + " nap " + pad2(hours) + " óra " + pad2(minutes) + " perc";
  }

  /* computeCounterState: a "jelenlegi szünet" és a "rekord" kiszámítása a
   * published incidensekből (ARCHITECTURE.md 7.1). A rekord a published
   * incidensek kronologikus sorrendjében az egymást követő két esemény
   * közötti legnagyobb időkülönbség, VAGY a jelenlegi szünet, ha az annál
   * nagyobb (így ha épp a valaha volt leghosszabb baleset-mentes
   * időszakban vagyunk, a rekord sor ugyanazt az élő értéket mutatja, mint
   * a fő számláló). 0 published incidens esetén "empty" állapotot ad
   * vissza, hogy a hívó barátságos üzenetet jeleníthessen meg NaN helyett. */
  function computeCounterState(incidents, now) {
    var published = incidents.filter(function (i) {
      return i.status === "published";
    });

    if (published.length === 0) {
      return { empty: true };
    }

    var sorted = published.slice().sort(function (a, b) {
      return eventSortKey(a).localeCompare(eventSortKey(b));
    });

    var latestDateTime = incidentDateTime(sorted[sorted.length - 1]);
    var currentGapMs = now.getTime() - latestDateTime.getTime();
    if (currentGapMs < 0) currentGapMs = 0;

    var maxHistoricalGapMs = 0;
    for (var idx = 1; idx < sorted.length; idx++) {
      var prevDateTime = incidentDateTime(sorted[idx - 1]);
      var curDateTime = incidentDateTime(sorted[idx]);
      var gap = curDateTime.getTime() - prevDateTime.getTime();
      if (gap > maxHistoricalGapMs) maxHistoricalGapMs = gap;
    }

    var recordGapMs = Math.max(maxHistoricalGapMs, currentGapMs);

    return { empty: false, currentGapMs: currentGapMs, recordGapMs: recordGapMs };
  }

  function renderCounter() {
    if (!els.counterCurrent || !els.counterRecord) return;
    var result = computeCounterState(state.incidents, new Date());

    if (result.empty) {
      els.counterCurrent.textContent = "Még nincs elég adat a számlálóhoz.";
      els.counterRecord.textContent = "";
      return;
    }

    els.counterCurrent.textContent = formatDuration(result.currentGapMs);
    els.counterRecord.textContent =
      "Rekord baleset nélkül: " + formatDuration(result.recordGapMs);
  }

  function startCounterTicking() {
    renderCounter();
    if (state.counterTimer) clearInterval(state.counterTimer);
    state.counterTimer = setInterval(renderCounter, 1000);
  }

  function formatDate(incident) {
    var out = incident.event_date;
    if (incident.event_time) {
      out += " " + incident.event_time;
    }
    return out;
  }

  function el(tag, opts) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined) node.textContent = opts.text;
    if (opts.attrs) {
      for (var k in opts.attrs) {
        node.setAttribute(k, opts.attrs[k]);
      }
    }
    return node;
  }

  function renderIncidentCard(incident) {
    var li = el("li", { className: "incident-card" });

    var rowTop = el("div", { className: "row-top" });
    rowTop.appendChild(el("span", { className: "incident-date", text: formatDate(incident) }));

    rowTop.appendChild(
      el("span", {
        className: "badge badge-mode-" + incident.mode,
        text: MODE_LABELS[incident.mode] || incident.mode,
      })
    );

    var injuryClass = "badge badge-injury";
    if (incident.injuries === "severe" || incident.injuries === "fatal") {
      injuryClass += " badge-injury-" + incident.injuries;
    }
    rowTop.appendChild(
      el("span", {
        className: injuryClass,
        text: INJURY_LABELS[incident.injuries] || incident.injuries,
      })
    );
    li.appendChild(rowTop);

    li.appendChild(el("p", { className: "incident-location", text: incident.location }));

    var tags =
      (EVENT_TYPE_LABELS[incident.event_type] || incident.event_type) +
      " · másik fél: " +
      (OTHER_PARTY_LABELS[incident.other_party] || incident.other_party);
    li.appendChild(el("p", { className: "incident-tags", text: tags }));

    li.appendChild(el("p", { className: "incident-summary", text: incident.summary }));

    var details = el("details", { className: "incident-sources" });
    var sources = incident.sources || [];
    details.appendChild(el("summary", { text: "Források (" + sources.length + ")" }));
    var ul = el("ul");
    sources.forEach(function (source) {
      var liSource = el("li");
      var a = el("a", {
        text: source.title || source.url,
        attrs: { href: source.url, target: "_blank", rel: "noopener" },
      });
      liSource.appendChild(a);
      liSource.appendChild(
        el("span", { className: "source-name", text: " – " + source.source_name })
      );
      ul.appendChild(liSource);
    });
    details.appendChild(ul);
    li.appendChild(details);

    return li;
  }

  function applyFilters(incidents) {
    var year = state.filters.year;
    var mode = state.filters.mode;
    var text = normalizeForSearch(state.filters.text);

    return incidents.filter(function (incident) {
      if (year && String(incident.event_date).slice(0, 4) !== year) return false;
      if (mode && incident.mode !== mode) return false;
      if (text) {
        var haystack =
          normalizeForSearch(incident.location) + " " + normalizeForSearch(incident.summary);
        if (haystack.indexOf(text) === -1) return false;
      }
      return true;
    });
  }

  function render() {
    var filtered = applyFilters(state.incidents);
    els.list.innerHTML = "";

    if (filtered.length === 0) {
      els.resultCount.textContent = "0 esemény";
      els.list.appendChild(
        el("li", { className: "incident-empty", text: "Nincs a szűrésnek megfelelő esemény." })
      );
      return;
    }

    els.resultCount.textContent = filtered.length + " esemény";
    filtered.forEach(function (incident) {
      els.list.appendChild(renderIncidentCard(incident));
    });
  }

  function populateYearOptions(incidents) {
    var years = Array.from(
      new Set(incidents.map(function (i) { return String(i.event_date).slice(0, 4); }))
    )
      .sort()
      .reverse();
    years.forEach(function (year) {
      els.yearSelect.appendChild(el("option", { text: year, attrs: { value: year } }));
    });
  }

  function showError(message) {
    els.status.hidden = false;
    els.status.textContent = message;
  }

  function hideError() {
    els.status.hidden = true;
    els.status.textContent = "";
  }

  function formatUpdatedAt(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return "Utolsó frissítés: " + d.toLocaleString("hu-HU");
  }

  function init() {
    els.yearSelect = document.getElementById("filter-year");
    els.modeSelect = document.getElementById("filter-mode");
    els.textInput = document.getElementById("filter-text");
    els.list = document.getElementById("incident-list");
    els.resultCount = document.getElementById("result-count");
    els.status = document.getElementById("status-message");
    els.updatedAt = document.getElementById("updated-at");
    els.counterCurrent = document.getElementById("counter-current");
    els.counterRecord = document.getElementById("counter-record");

    els.yearSelect.addEventListener("change", function () {
      state.filters.year = els.yearSelect.value;
      render();
    });
    els.modeSelect.addEventListener("change", function () {
      state.filters.mode = els.modeSelect.value;
      render();
    });
    els.textInput.addEventListener("input", function () {
      state.filters.text = els.textInput.value;
      render();
    });

    Promise.all([
      fetch("data/incidents.json").then(function (r) {
        if (!r.ok) throw new Error("incidents.json: HTTP " + r.status);
        return r.json();
      }),
      fetch("data/meta.json").then(function (r) {
        if (!r.ok) throw new Error("meta.json: HTTP " + r.status);
        return r.json();
      }),
    ])
      .then(function (results) {
        var incidentsDoc = results[0];
        var meta = results[1];
        state.incidents = (incidentsDoc.incidents || []).slice().sort(function (a, b) {
          return eventSortKey(b).localeCompare(eventSortKey(a));
        });
        populateYearOptions(state.incidents);
        els.updatedAt.textContent = formatUpdatedAt(meta.updated_at);
        hideError();
        render();
        startCounterTicking();
      })
      .catch(function (err) {
        showError(
          "Nem sikerült betölteni az adatokat. Próbáld frissíteni az oldalt később. (" +
            err.message +
            ")"
        );
        els.resultCount.textContent = "";
        renderCounter();
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
