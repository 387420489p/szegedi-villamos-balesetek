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

  var TAG_CLOUD_FIELDS = [
    { field: "mode", labels: MODE_LABELS, className: function (v) { return "badge badge-mode-" + v; } },
    { field: "other_party", labels: OTHER_PARTY_LABELS, className: partyBadgeClass },
    { field: "event_type", labels: EVENT_TYPE_LABELS, className: function () { return "badge badge-event-type"; } },
    { field: "injuries", labels: INJURY_LABELS, className: injuryBadgeClass },
  ];

  /* buildTagCloud: a kereső alatt egy helyen felsorolja MINDEN ténylegesen
   * előforduló címkét (nem találjuk ki, csak amit a valós adat tartalmaz),
   * gyakoriság szerint csökkenő sorrendben, gyakoriság-arányos betűmérettel
   * -- klasszikus "tag cloud". Így nem kell kártyánként vadászni a
   * címkékre, egy helyen kattinthatók. */
  function buildTagCloud(incidents) {
    if (!els.tagCloud) return;
    els.tagCloud.innerHTML = "";
    els.tagCloudBadges = [];

    TAG_CLOUD_FIELDS.forEach(function (spec) {
      var counts = {};
      incidents.forEach(function (incident) {
        var value = incident[spec.field];
        if (value === undefined || value === null || value === "") return;
        counts[value] = (counts[value] || 0) + 1;
      });
      var entries = Object.keys(counts)
        .map(function (value) { return { value: value, count: counts[value] }; })
        .sort(function (a, b) { return b.count - a.count; });
      if (entries.length === 0) return;

      var maxCount = entries[0].count;
      var minCount = entries[entries.length - 1].count;

      entries.forEach(function (entry) {
        var text = spec.labels[entry.value] || entry.value;
        var badge = tagBadge(spec.className(entry.value), text, spec.field, entry.value);
        var weight = maxCount === minCount ? 1 : (entry.count - minCount) / (maxCount - minCount);
        badge.style.fontSize = (0.62 + weight * 0.16) + "rem";
        badge.title = text + " (" + entry.count + " esemény) — " + badge.title;
        els.tagCloud.appendChild(badge);
        els.tagCloudBadges.push({ el: badge, field: spec.field, value: entry.value });
      });
    });

    updateTagCloudActiveState();
  }

  function updateTagCloudActiveState() {
    if (!els.tagCloudBadges) return;
    var tag = state.filters.tag;
    els.tagCloudBadges.forEach(function (entry) {
      var active = !!tag && tag.field === entry.field && String(tag.value) === String(entry.value);
      entry.el.classList.toggle("tag-cloud-badge-active", active);
    });
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
    } else {
      els.tagChip.hidden = false;
      els.tagChipLabel.textContent = tag.label;
    }
    updateTagCloudActiveState();
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

  /* initHitCounter: valódi, oldalanként egyedi látogatószámláló egy
   * ingyenes, hitelesítés nélküli badge-szolgáltatáson keresztül (csak egy
   * <img> kérés, nincs saját backend). Ha a szolgáltatás nem elérhető, a
   * HTML-ben eleve ott lévő "sok" tartalék szöveg marad látható -- inkább
   * hiányzó adat, mint kitalált szám. */
  function initHitCounter() {
    var img = document.getElementById("hit-counter-img");
    var fallback = document.getElementById("hit-counter-fallback");
    if (!img) return;
    img.addEventListener("load", function () {
      img.hidden = false;
      if (fallback) fallback.hidden = true;
    });
    img.addEventListener("error", function () {
      img.hidden = true;
      if (fallback) fallback.hidden = false;
    });
    img.src =
      "https://visitor-badge.laobi.icu/badge?page_id=szegedi-villamos-balesetek.github-pages";
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
    els.tagCloud = document.getElementById("tag-cloud");

    initHitCounter();

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
        buildTagCloud(state.incidents);
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
