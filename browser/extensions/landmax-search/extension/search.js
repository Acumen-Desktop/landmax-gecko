"use strict";
// The Search panel (docs/search-plan.md): Google's answer as a grid you can sort and filter. Every search starts
// from a click or Enter; nothing runs on its own. Looking inside the results (pictures, read time, junk) happens
// once per search, for its own results only.

const $ = id => document.getElementById(id);
const out = $("out");
const ask = msg => browser.runtime.sendMessage(msg);
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");

// ---------- State ----------
let view = params.get("view") || null; // "summary", "web", "news"; null = picked from the words
let look = "grid"; // "grid" or "wall"
let sort = { key: "rank", up: true };
let filters = new Set(); // "kind:News", "age:d", "free", "clean", "both"
let state = null; // { words, sent, summary, rows, ads, duck: "no" | "asking" | "done" }

// "Never show" and "Prefer" sites, and saved views, kept on this computer.
const kept = { never: [], prefer: [], views: [], inside: true };
const ready = browser.storage.local.get(["never", "prefer", "views", "inside"]).then(s => {
  kept.never = s.never || [];
  kept.prefer = s.prefer || [];
  kept.views = s.views || [];
  kept.inside = s.inside !== false;
  $("inside").checked = kept.inside;
  drawViews();
});
const save = () => browser.storage.local.set({ never: kept.never, prefer: kept.prefer, views: kept.views, inside: kept.inside });

// ---------- Small helpers ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function note(text, warn) {
  out.replaceChildren(el("p", "note" + (warn ? " warn" : ""), text));
}
function pressed(sel, test) {
  for (const b of document.querySelectorAll(sel)) b.setAttribute("aria-pressed", String(test(b)));
}

// A question gets Google's summary (Google writes one mostly for questions); a few words get plain results.
function pickView(words) {
  const w = words.trim().toLowerCase();
  const question = /\?$/.test(w) || /^(how|what|why|when|where|who|which|is|are|can|does|do|should|will)\b/.test(w);
  return question || w.split(/\s+/).length >= 5 ? "summary" : "web";
}

// Age in minutes from Google's words ("3 hours ago", "Mar 31, 2026") or the page's own date.
function ageOf(text, iso) {
  const now = Date.now();
  const m = /(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago/i.exec(text || "");
  if (m) return +m[1] * { minute: 1, hour: 60, day: 1440, week: 10080, month: 43200, year: 525600 }[m[2].toLowerCase()];
  const t = Date.parse(text || "") || Date.parse(iso || "");
  return t ? Math.max(0, Math.round((now - t) / 60000)) : null;
}
function ageText(min) {
  if (min == null) return "";
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  if (min < 43200) return `${Math.round(min / 1440)} d`;
  if (min < 525600) return `${Math.round(min / 43200)} mo`;
  return `${Math.round(min / 525600)} y`;
}
const junkColour = s => (s < 25 ? "var(--accent)" : s < 55 ? "var(--warn)" : "var(--bad)");
const junkWord = s => (s < 25 ? "Clean" : s < 55 ? "Some junk" : "Heavy");
const keyOf = href => {
  try {
    const u = new URL(href);
    return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "");
  } catch {
    return href;
  }
};

// ---------- Searching ----------
function opts() {
  return {
    debug: DEBUG,
    view: view || pickView($("words").value),
    when: $("when").value,
    exact: $("exact").checked,
    private: $("private").checked,
    never: kept.never,
  };
}

async function search() {
  const words = $("words").value.trim();
  if (!words) return;
  await ready;
  const o = opts();
  pressed(".seg [data-view]", b => b.dataset.view === o.view);
  note("Searching…");
  try {
    const page = await ask({ type: "google", words, opts: o });
    console.log("Landmax Search:", page.check ? "Google's check" : `${page.results.length} results, summary ${!!page.summary}`);
    if (DEBUG) console.log("LANDMAX-PAGE " + btoa(unescape(encodeURIComponent(JSON.stringify(page)))));
    $("sent").hidden = false;
    $("sent").textContent = "Google sees: " + page.sent;
    if (page.check) {
      showCheck(page.tabId);
      return;
    }
    state = {
      words,
      view: o.view,
      summary: o.view === "summary" ? page.summary : null,
      ads: page.ads,
      duck: "no",
      rows: page.results.map((r, i) => ({
        ...r,
        key: keyOf(r.href),
        g: i + 1,
        d: null,
        age: ageOf(r.date),
        kind: "",
        inside: null,
      })),
    };
    filters = new Set([...filters].filter(f => !f.startsWith("kind:")));
    draw();
    fill();
  } catch (e) {
    console.error("Landmax Search:", e);
    note("Google didn't answer: " + e.message, true);
  }
}

// Kinds from the address, then (with Look inside) everything from the page itself, row by row as it arrives.
async function fill() {
  const s = state;
  await Promise.all(
    s.rows.map(async row => {
      row.kind ||= await ask({ type: "kindOfHost", host: row.host || "" });
      if (!kept.inside || row.inside || !/^https?:/.test(row.href) || /google\.[a-z.]+\/goto/.test(row.href)) return;
      row.inside = "loading";
      if (s === state) drawRows();
      const got = await ask({ type: "enrich", url: row.href });
      row.inside = got;
      if (got.kind) row.kind = got.kind;
      if (row.age == null && got.published) row.age = ageOf("", got.published);
      if (s === state) draw();
    })
  );
  // Kinds the pages didn't give: one question to JEV for all of them (never in Private: it would learn the search).
  const unknown = s.rows.filter(r => !r.kind && r.title);
  if (unknown.length && !$("private").checked) {
    try {
      const got = await ask({ type: "classify", rows: unknown.map((r, i) => ({ id: i, title: r.title, site: r.site, snippet: r.snippet })) });
      for (const [i, k] of Object.entries(got?.kinds || {})) {
        unknown[+i].kind = k.kind;
        unknown[+i].kindBy = "JEV";
      }
    } catch (e) {
      console.error("Landmax Search: JEV", e);
    }
  }
  if (s === state) draw();
  if (DEBUG) console.log("LANDMAX-STATE " + btoa(unescape(encodeURIComponent(JSON.stringify(s)))));
}

function showCheck(tabId) {
  out.replaceChildren(
    el("p", "note warn", "Google wants to check that a person is searching, not a program."),
    el("p", "note", "Answer Google's check yourself; your search continues after it.")
  );
  const b = el("button", "action", "Show Google's check");
  b.onclick = () => ask({ type: "showCheck", tabId });
  out.append(b);
}
browser.runtime.onMessage.addListener(msg => {
  if (msg.type === "checkDone") search();
});

async function askDuck() {
  const s = state;
  s.duck = "asking";
  draw();
  try {
    const { results } = await ask({ type: "duck", words: s.words });
    results.forEach((r, i) => {
      const key = keyOf(r.url);
      const same = s.rows.find(x => x.key === key || (x.host && x.host === r.site && x.title === r.title));
      if (same) {
        same.d = i + 1;
      } else if (!kept.never.includes(r.site)) {
        s.rows.push({ title: r.title, href: r.url, site: r.site, host: r.site, address: r.site, snippet: r.snippet, key, g: null, d: i + 1, age: null, kind: "", inside: null });
      }
    });
    s.duck = "done";
  } catch {
    s.duck = "failed";
  }
  if (s === state) {
    draw();
    fill();
  }
}

// ---------- Sorting and filtering ----------
const SORTS = {
  rank: r => Math.min(r.g ?? 99, r.d ?? 99) + (r.g && r.d ? -0.5 : 0),
  age: r => r.age ?? 1e9,
  read: r => (r.inside?.readMin ? r.inside.readMin : 1e9),
  junk: r => r.inside?.junk?.score ?? 1e9,
  kind: r => r.kind || "~",
  site: r => (r.site || "").toLowerCase(),
};

function visible() {
  const kinds = [...filters].filter(f => f.startsWith("kind:")).map(f => f.slice(5));
  let rows = state.rows.filter(r => !kept.never.includes(r.host));
  if (kinds.length) rows = rows.filter(r => kinds.includes(r.kind || "Other"));
  if (filters.has("age:d")) rows = rows.filter(r => r.age != null && r.age <= 1440);
  if (filters.has("age:w")) rows = rows.filter(r => r.age != null && r.age <= 10080);
  if (filters.has("free")) rows = rows.filter(r => !r.inside?.paywall);
  if (filters.has("clean")) rows = rows.filter(r => r.inside?.junk && r.inside.junk.score < 25);
  if (filters.has("both")) rows = rows.filter(r => r.g && r.d);
  const f = SORTS[sort.key];
  const pref = r => (kept.prefer.includes(r.host) ? 0 : 1);
  return rows.sort((a, b) => {
    const x = f(a), y = f(b);
    const c = typeof x === "string" ? x.localeCompare(y) : x - y;
    return (sort.key === "rank" ? pref(a) - pref(b) : 0) || (sort.up ? c : -c);
  });
}

function drawFilters() {
  const box = $("filters");
  if (!state) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.replaceChildren();
  const count = {};
  for (const r of state.rows) count[r.kind || "Other"] = (count[r.kind || "Other"] || 0) + 1;
  const chip = (id, label, n) => {
    const b = el("button", "chip");
    b.type = "button";
    b.append(label);
    if (n != null) b.append(el("span", "n", String(n)));
    b.setAttribute("aria-pressed", String(filters.has(id)));
    b.onclick = () => {
      filters.has(id) ? filters.delete(id) : filters.add(id);
      if (id === "age:d") filters.delete("age:w");
      if (id === "age:w") filters.delete("age:d");
      draw();
    };
    box.append(b);
  };
  for (const k of Object.keys(count).sort((a, b) => count[b] - count[a])) chip("kind:" + k, k, count[k]);
  chip("age:d", "Last day");
  chip("age:w", "Last week");
  if (kept.inside) {
    chip("free", "Free to read");
    chip("clean", "Clean only");
  }
  if (state.duck === "done") chip("both", "Both engines");
  if (filters.size) {
    const c = el("button", "chip clear", "Clear");
    c.type = "button";
    c.onclick = () => {
      filters.clear();
      draw();
    };
    box.append(c);
  }
}

// Saved views: the sort, filters and layout, one click to use again.
function drawViews() {
  const box = $("views");
  box.replaceChildren();
  box.hidden = !state && !kept.views.length;
  for (const v of kept.views) {
    const b = el("button", "chip view", v.name);
    b.type = "button";
    b.title = "Use this view (right-click to remove it)";
    b.onclick = () => {
      sort = { ...v.sort };
      filters = new Set(v.filters);
      look = v.look;
      if (state) draw();
    };
    b.oncontextmenu = e => {
      e.preventDefault();
      kept.views = kept.views.filter(x => x !== v);
      save();
      drawViews();
    };
    box.append(b);
  }
  if (state) {
    const s = el("button", "chip save", "+ Save this view");
    s.type = "button";
    s.onclick = () => {
      const name = prompt("Name this view (for example: Newest clean news)");
      if (!name) return;
      kept.views.push({ name, sort: { ...sort }, filters: [...filters], look });
      save();
      drawViews();
    };
    box.append(s);
  }
}

// ---------- Drawing ----------
function draw() {
  if (!state) return;
  pressed(".seg [data-look]", b => b.dataset.look === look);
  drawFilters();
  drawViews();
  out.replaceChildren();
  if (state.summary?.paragraphs.length) out.append(summaryBlock(state.summary));
  const holder = el("div", "rows");
  out.append(holder);
  drawRows(holder);
  out.append(foot());
  document.documentElement.style.setProperty("--head", document.querySelector("header").offsetHeight + "px");
}

function drawRows(holder = out.querySelector(".rows")) {
  if (!holder) return;
  const rows = visible();
  holder.replaceChildren(
    !rows.length ? el("p", "note", "Nothing matches. Clear a filter, or try fewer words.") : look === "wall" ? wall(rows) : grid(rows)
  );
}

function thumb(r, big) {
  const t = el("div", "thumb");
  const pic = r.inside?.picture;
  if (r.inside === "loading") {
    t.classList.add("loading");
  } else if (pic) {
    // Loaded straight from the site, with no referrer.
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => (t.style.backgroundImage = `url("${pic.replace(/"/g, "%22")}")`);
    img.onerror = () => (t.textContent = (r.site || "?")[0].toUpperCase());
    img.src = pic;
  } else {
    t.textContent = (r.site || r.host || "?")[0].toUpperCase();
  }
  if (big) t.classList.add("big");
  return t;
}

function header(label, key, cls) {
  const th = el("th", cls || null, label);
  if (key) {
    th.dataset.sort = key;
    if (sort.key === key) th.classList.add("on", ...(sort.up ? ["up"] : []));
    th.onclick = () => {
      sort = sort.key === key ? { key, up: !sort.up } : { key, up: true };
      draw();
    };
  }
  return th;
}

function grid(rows) {
  const t = el("table", "grid");
  const hr = el("tr");
  hr.append(
    header("", null, "pic"),
    header("Result", "site"),
    header("Kind", "kind", "c-kind"),
    header("Age", "age", "num"),
    header("Read", "read", "num c-read"),
    header("Junk", "junk", "num"),
    header("Found", "rank", "c-found"),
    header("", null)
  );
  t.append(el("thead"), el("tbody"));
  t.tHead.append(hr);
  for (const r of rows) t.tBodies[0].append(row(r));
  return t;
}

function row(r) {
  const tr = el("tr", "row");
  if (kept.prefer.includes(r.host)) tr.classList.add("preferred");
  tr.onclick = () => ask({ type: "open", url: r.href });
  const inside = r.inside && r.inside !== "loading" ? r.inside : null;

  const pic = el("td", "pic");
  pic.append(thumb(r));

  const what = el("td", "what");
  const site = el("div", "site", r.site || r.host || "");
  if (inside?.paywall) site.append(el("span", "lock", "🔒 paywall"));
  if (inside?.author && inside.author.toLowerCase() !== (r.site || "").toLowerCase()) site.append(el("span", null, "· " + inside.author));
  what.append(site, el("div", "title", r.title), el("div", "snippet", r.snippet || ""));

  const kind = el("td", "c-kind");
  if (r.kind) {
    const k = el("span", "kind", r.kind);
    k.dataset.k = r.kind;
    k.title = r.kindBy === "JEV" ? "Kind guessed by JEV from the title and snippet" : "Kind as the page itself says";
    kind.append(k);
  }

  const age = el("td", "num", ageText(r.age));
  const read = el("td", "num c-read", inside?.readMin ? `${inside.readMin} min` : "");

  const junk = el("td", "num");
  if (inside?.junk) {
    const j = inside.junk;
    const w = el("span", "junk");
    w.title = `${junkWord(j.score)}: ${j.kb} KB of page code, ${j.scripts} scripts from ${j.hosts} other sites` +
      (j.trackers.length ? `\nAd and tracker companies: ${j.trackers.join(", ")}` : "\nNo known ad or tracker companies");
    const m = el("span", "meter");
    const bar = el("i");
    bar.style.width = Math.max(6, j.score) + "%";
    bar.style.background = junkColour(j.score);
    m.append(bar);
    w.append(m, String(j.trackers.length));
    junk.append(w);
  } else if (inside?.failed) {
    junk.textContent = "—";
    junk.title = "Couldn't look inside: " + inside.failed;
  }

  const found = el("td", "c-found");
  const f = el("span", "found");
  if (r.g) f.append(el("span", "g", "G" + r.g));
  if (r.d) f.append(el("span", "d", "D" + r.d));
  found.append(f);

  const acts = el("td", "acts");
  if (r.host && r.host.includes(".")) {
    const p = el("button", "prefer", "★");
    p.title = kept.prefer.includes(r.host) ? "Stop preferring " + r.host : "Prefer " + r.host + ": show it first from now on";
    p.onclick = e => {
      e.stopPropagation();
      kept.prefer = kept.prefer.includes(r.host) ? kept.prefer.filter(h => h !== r.host) : [...kept.prefer, r.host];
      save();
      draw();
    };
    const n = el("button", "never", "⦸");
    n.title = "Never show " + r.host + " again";
    n.onclick = e => {
      e.stopPropagation();
      kept.never.push(r.host);
      save();
      draw();
    };
    acts.append(p, " ", n);
  }
  tr.append(pic, what, kind, age, read, junk, found, acts);
  return tr;
}

function wall(rows) {
  const w = el("div", "wall");
  for (const r of rows) {
    const t = el("div", "tile");
    t.onclick = () => ask({ type: "open", url: r.href });
    const body = el("div", "body");
    const meta = el("div", "meta");
    meta.append(r.site || "", r.age != null ? " · " + ageText(r.age) : "");
    if (r.kind) {
      const k = el("span", "kind", r.kind);
      k.dataset.k = r.kind;
      meta.append(k);
    }
    body.append(el("div", "title", r.title), meta);
    t.append(thumb(r, true), body);
    w.append(t);
  }
  return w;
}

function summaryBlock(s) {
  const box = el("section", "summary folded");
  box.append(el("h2", null, "Google's summary · may be wrong"));
  for (const t of s.paragraphs) {
    const kind = t.startsWith("• ") ? "bullet" : t.length < 60 && !/[.:!?]$/.test(t) ? "head" : null;
    box.append(el("p", kind, t));
  }
  if (s.paragraphs.length > 3) {
    const more = el("button", "more", "Show all");
    more.onclick = () => {
      box.classList.remove("folded");
      more.remove();
    };
    box.append(more);
  }
  if (s.sources.length) {
    const row = el("div", "sources");
    for (const src of s.sources) {
      const b = el("button", null, src.name);
      b.onclick = () => ask({ type: "open", url: src.href });
      row.append(b);
    }
    box.append(row);
  }
  return box;
}

function foot() {
  const f = el("div", "foot");
  const left = el("span");
  const shown = visible().length;
  const parts = [`${shown} of ${state.rows.length} results`];
  if (state.ads) parts.push(`${state.ads} ${state.ads === 1 ? "ad" : "ads"} removed`);
  const junk = state.rows.map(r => r.inside?.junk?.trackers.length || 0).reduce((a, b) => a + b, 0);
  if (junk) parts.push(`${junk} trackers you'd have met`);
  left.textContent = parts.join(" · ");
  f.append(left);
  if (state.duck === "no" || state.duck === "failed") {
    const b = el("button", "action", state.duck === "failed" ? "DuckDuckGo didn't answer: try again" : "＋ Also ask DuckDuckGo");
    b.title = "One more search, at DuckDuckGo; its results join the grid, marked D";
    b.onclick = askDuck;
    f.append(b);
  } else if (state.duck === "asking") {
    f.append(el("span", null, "Asking DuckDuckGo…"));
  }
  return f;
}

// ---------- Controls ----------
$("form").addEventListener("submit", e => {
  e.preventDefault();
  view = null;
  search();
});
for (const b of document.querySelectorAll(".seg [data-view]")) {
  b.onclick = () => {
    view = b.dataset.view;
    search();
  };
}
for (const b of document.querySelectorAll(".seg [data-look]")) {
  b.onclick = () => {
    look = b.dataset.look;
    draw();
  };
}
$("when").onchange = () => $("words").value.trim() && search();
$("exact").onchange = () => $("words").value.trim() && search();
$("inside").onchange = () => {
  kept.inside = $("inside").checked;
  save();
  if (state) {
    draw();
    fill();
  }
};
$("private").onchange = async () => {
  document.body.classList.toggle("is-private", $("private").checked);
  if (!$("private").checked) await ask({ type: "endPrivate" });
  state = null;
  $("filters").hidden = true;
  note($("private").checked ? "Private: signed out, nothing remembered." : "Signed in again.");
};
pressed(".seg [data-look]", b => b.dataset.look === look);

// Opened with ?q= (landmax-search <words>): run that one search.
const asked = params.get("q");
if (asked) {
  $("words").value = asked;
  search();
}
