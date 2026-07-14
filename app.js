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

  var PAGE_SIZE = 10;

  var state = {
    incidents: [],
    filters: { year: "", mode: "", text: "", tag: null },
    counterTimer: null,
    visibleCount: PAGE_SIZE,
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

  function partyBadgeClass(otherParty) {
    return "badge badge-party badge-party-" + (otherParty || "unknown");
  }

  function injuryBadgeClass(injuries) {
    var cls = "badge badge-injury";
    if (injuries === "severe" || injuries === "fatal") {
      cls += " badge-injury-" + injuries;
    }
    return cls;
  }

  /* tagBadge: kattintható/Enter-rel aktiválható badge, ami a listát az
   * adott mező pontos értékére szűri (tag alapú keresés -- lásd
   * setTagFilter). */
  function tagBadge(className, text, field, value) {
    var span = el("span", { className: className + " badge-clickable", text: text });
    span.setAttribute("role", "button");
    span.setAttribute("tabindex", "0");
    span.setAttribute("title", "Szűrés erre a címkére: " + text);
    span.addEventListener("click", function () {
      setTagFilter(field, value, text);
    });
    span.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        setTagFilter(field, value, text);
      }
    });
    return span;
  }

  /* A kártya minden mezője rögtön látszik -- nincs soronkénti
   * lenyitás/összecsukás, csak a TELJES LISTA van lapozva (render()),
   * hogy 99+ esemény ne töltse meg egyetlen végtelen listává az oldalt. */
  function renderIncidentCard(incident) {
    var li = el("li", { className: "incident-card" });

    var summaryRow = el("div", { className: "incident-summary-row" });
    summaryRow.appendChild(el("span", { className: "incident-date", text: formatDate(incident) }));
    summaryRow.appendChild(el("span", { className: "incident-location", text: incident.location }));
    li.appendChild(summaryRow);

    var body = el("div", { className: "incident-body" });

    /* Minden címke (jármű, másik fél, esemény típusa, sérülés) egy közös
     * sorban -- korábban a jármű/másik fél a fejlécben, a többi a törzsben
     * volt, ami két külön helyre szórta szét ugyanazt az információt. */
    var tagRow = el("div", { className: "incident-tag-row" });
    tagRow.appendChild(
      tagBadge(
        "badge badge-mode-" + incident.mode,
        MODE_LABELS[incident.mode] || incident.mode,
        "mode",
        incident.mode
      )
    );
    tagRow.appendChild(
      tagBadge(
        partyBadgeClass(incident.other_party),
        OTHER_PARTY_LABELS[incident.other_party] || incident.other_party,
        "other_party",
        incident.other_party
      )
    );
    tagRow.appendChild(
      tagBadge(
        "badge badge-event-type",
        EVENT_TYPE_LABELS[incident.event_type] || incident.event_type,
        "event_type",
        incident.event_type
      )
    );
    tagRow.appendChild(
      tagBadge(
        injuryBadgeClass(incident.injuries),
        INJURY_LABELS[incident.injuries] || incident.injuries,
        "injuries",
        incident.injuries
      )
    );
    body.appendChild(tagRow);

    body.appendChild(el("p", { className: "incident-summary", text: incident.summary }));

    var sourcesBlock = el("div", { className: "incident-sources" });
    var sources = incident.sources || [];
    sourcesBlock.appendChild(
      el("p", { className: "incident-sources-label", text: "Források (" + sources.length + "):" })
    );
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
    sourcesBlock.appendChild(ul);
    body.appendChild(sourcesBlock);

    li.appendChild(body);
    return li;
  }

  function applyFilters(incidents) {
    var year = state.filters.year;
    var mode = state.filters.mode;
    var text = normalizeForSearch(state.filters.text);
    var tag = state.filters.tag;

    return incidents.filter(function (incident) {
      if (year && String(incident.event_date).slice(0, 4) !== year) return false;
      if (mode && incident.mode !== mode) return false;
      if (tag && incident[tag.field] !== tag.value) return false;
      if (text) {
        var haystack = [
          incident.location,
          incident.summary,
          OTHER_PARTY_LABELS[incident.other_party] || incident.other_party,
          EVENT_TYPE_LABELS[incident.event_type] || incident.event_type,
          MODE_LABELS[incident.mode] || incident.mode,
        ]
          .map(normalizeForSearch)
          .join(" ");
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
      els.showMore.hidden = true;
      els.showAll.hidden = true;
      return;
    }

    var visible = filtered.slice(0, state.visibleCount);
    els.resultCount.textContent =
      filtered.length + " esemény" +
      (filtered.length > visible.length ? " (" + visible.length + " megjelenítve)" : "");

    visible.forEach(function (incident) {
      els.list.appendChild(renderIncidentCard(incident));
    });

    var remaining = filtered.length - visible.length;
    if (remaining > 0) {
      els.showMore.hidden = false;
      els.showMore.textContent =
        "Mutass többet (" + Math.min(remaining, PAGE_SIZE) + ")";
      els.showAll.hidden = false;
      els.showAll.textContent = "Mutasd az összeset (" + remaining + " további)";
    } else {
      els.showMore.hidden = true;
      els.showAll.hidden = true;
    }
  }

  function resetAndRender() {
    state.visibleCount = PAGE_SIZE;
    render();
  }

  function updateTagChip() {
    var tag = state.filters.tag;
    if (!tag) {
      els.tagChip.hidden = true;
      return;
    }
    els.tagChip.hidden = false;
    els.tagChipLabel.textContent = tag.label;
  }

  /* setTagFilter: tag-badge-re kattintva a teljes listát az adott mező
   * (jármű / másik fél / esemény típusa / sérülés) pontos értékére
   * szűri -- ez a "tag alapú keresés". A szabadszavas kereső eddig is
   * a fordított címke-szövegre is illesztett, de csak részszöveg-egyezés
   * alapján; ez itt pontos, egykattintásos szűrés. */
  function setTagFilter(field, value, label) {
    state.filters.tag = { field: field, value: value, label: label };
    updateTagChip();
    resetAndRender();
  }

  function clearTagFilter() {
    state.filters.tag = null;
    updateTagChip();
    resetAndRender();
  }

  var NEW_BADGE_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;

  /* updateNewBadge: az "ÚJ ESEMÉNY!" jelvény csak akkor látszik, ha a
   * legutóbbi published incidens ténylegesen friss (21 napon belüli) --
   * a projekt elve, hogy semmit nem állítunk, ami nem igaz, egy vicces
   * badge sem kivétel. */
  function updateNewBadge(incidents) {
    if (!els.newBadge) return;
    var published = incidents.filter(function (i) {
      return i.status === "published";
    });
    if (published.length === 0) {
      els.newBadge.hidden = true;
      return;
    }
    var sorted = published.slice().sort(function (a, b) {
      return eventSortKey(b).localeCompare(eventSortKey(a));
    });
    var latest = incidentDateTime(sorted[0]);
    var age = new Date().getTime() - latest.getTime();
    els.newBadge.hidden = !(age >= 0 && age <= NEW_BADGE_WINDOW_MS);
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
    els.showMore = document.getElementById("show-more");
    els.showAll = document.getElementById("show-all");
    els.tagChip = document.getElementById("tag-filter-chip");
    els.tagChipLabel = document.getElementById("tag-filter-label");
    els.tagChipClear = document.getElementById("tag-filter-clear");
    els.newBadge = document.getElementById("new-event-badge");

    els.tagChipClear.addEventListener("click", clearTagFilter);

    els.yearSelect.addEventListener("change", function () {
      state.filters.year = els.yearSelect.value;
      resetAndRender();
    });
    els.modeSelect.addEventListener("change", function () {
      state.filters.mode = els.modeSelect.value;
      resetAndRender();
    });
    els.textInput.addEventListener("input", function () {
      state.filters.text = els.textInput.value;
      resetAndRender();
    });
    els.showMore.addEventListener("click", function () {
      state.visibleCount += PAGE_SIZE;
      render();
    });
    els.showAll.addEventListener("click", function () {
      state.visibleCount = Infinity;
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
        updateNewBadge(state.incidents);
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
