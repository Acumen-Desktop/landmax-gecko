"use strict";
// The Search panel (docs/search-plan.md, docs/search-next.md). Google-simple: one box, an engine picker, and the
// power behind one Refine button. Results are a grid (a wide window) or picture cards (a tall one), beside or above
// a details pane that says whether to trust the chosen page. Every search is kept (except Private ones), so Back,
// Forward and the recent searches show exactly what you saw, without asking again.
// Old computers first: nothing loads that isn't needed. Every search starts from Enter or a button.

const $ = id => document.getElementById(id);
const list = $("list");
const detail = $("detail");
const ask = msg => browser.runtime.sendMessage(msg);
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");

const ENGINES = [
  { id: "google", name: "Google", icon: "engines/google.png" },
  { id: "duck", name: "DuckDuckGo", icon: "engines/duck.svg" },
  { id: "brave", name: "Brave", icon: "engines/brave.svg" },
];
const ALL = { id: "all", name: "All of them" };
const engineOf = id => ENGINES.find(e => e.id === id) || ALL;

// ---------- State ----------
let state = null; // { id, words, engine, opts, at, summary, rows, ads, failed, busy, judging, sel, saved }
let order = "rank";
let only = new Set(); // "reporting", "notselling", "free", "clean"
let pos = -1; // where the shown search is in the history (-1: not kept, e.g. Private)

// Kept on this computer: the history, the "Never show" and "Prefer" sites, and the choices.
const kept = { history: [], never: [], prefer: [], inside: true, engine: "google", look: "auto" };
const ready = browser.storage.local.get(["history", "never", "prefer", "inside", "engine", "look"]).then(s => {
  kept.history = s.history || [];
  kept.never = s.never || [];
  kept.prefer = s.prefer || [];
  kept.inside = s.inside !== false;
  kept.engine = params.get("engine") || s.engine || "google";
  kept.look = params.get("look") || s.look || "auto";
  $("inside").checked = kept.inside;
  drawEngines();
  drawSites();
  drawRecent();
  if (DEBUG) console.log("LANDMAX-HISTORY " + kept.history.length);
});
const save = (...keys) => browser.storage.local.set(Object.fromEntries(keys.map(k => [k, kept[k]])));

// ---------- Library's colours ----------
ask({ type: "theme" })
  .then(({ colours: c } = {}) => {
    if (!c || !c.background) return;
    const set = (name, value) => value && document.documentElement.style.setProperty(name, value);
    set("--bg", c.background);
    set("--panel", c.lighter_background);
    set("--raise", c.selection);
    set("--line", c.muted || c.selection);
    set("--ink", c.foreground);
    set("--dim", c.dark_foreground);
    set("--accent", c.accent);
    set("--accent-ink", c.darker_background || c.background);
    for (const k of ["red", "orange", "yellow", "green", "cyan", "blue", "magenta"]) set("--" + k, c[k]);
    document.documentElement.style.colorScheme = c.mode === "light" ? "light" : "dark";
  })
  .catch(() => {});

// ---------- Small helpers ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function button(cls, text, onclick, title) {
  const b = el("button", cls, text);
  b.type = "button";
  b.onclick = onclick;
  if (title) b.title = title;
  return b;
}
function icon(engine, cls = "eicon") {
  const img = new Image();
  img.className = cls;
  img.alt = "";
  img.src = engine.icon;
  return img;
}
const loaded = r => (r.inside && r.inside !== "loading" ? r.inside : null);
const newsy = words => /\b(news|latest|today|tonight|yesterday|this week|breaking|headlines?)\b/i.test(words);

function ageOf(text, iso) {
  const m = /(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago/i.exec(text || "");
  if (m) return +m[1] * { minute: 1, hour: 60, day: 1440, week: 10080, month: 43200, year: 525600 }[m[2].toLowerCase()];
  const t = Date.parse(text || "") || Date.parse(iso || "");
  return t ? Math.max(0, Math.round((Date.now() - t) / 60000)) : null;
}
function ageText(min, short) {
  if (min == null) return "";
  if (min < 60) return short ? `${min} min` : `${min} min ago`;
  if (min < 1440) return short ? `${Math.round(min / 60)} h` : `${Math.round(min / 60)} h ago`;
  if (min < 2880) return "yesterday";
  if (min < 43200) return short ? `${Math.round(min / 1440)} d` : `${Math.round(min / 1440)} days ago`;
  if (min < 525600) return short ? `${Math.round(min / 43200)} mo` : `${Math.round(min / 43200)} mo ago`;
  return short ? `${Math.round(min / 525600)} y` : `${Math.round(min / 525600)} y ago`;
}
const sinceText = at => ageText(Math.round((Date.now() - at) / 60000)) || "just now";
const keyOf = href => {
  try {
    const u = new URL(href);
    return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "");
  } catch {
    return href;
  }
};
function cleanLink(href) {
  try {
    const u = new URL(href);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|mc_|pk_)|^(fbclid|gclid|dclid|msclkid|igshid|yclid|ref|ref_src|_hsenc|_hsmi|si)$/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return href;
  }
}
// The site's icon only when the engine sent it inside its page (no extra download); else its letter, in its colour.
function favicon(r) {
  if (r.icon?.startsWith("data:")) {
    const img = new Image(16, 16);
    img.className = "fav";
    img.alt = "";
    img.src = r.icon;
    return img;
  }
  const f = el("span", "fav none", (r.site || r.host || "?").replace(/^www\./, "")[0].toUpperCase());
  f.dataset.k = r.kind || "Other";
  return f;
}
// A page's picture, loaded only when it scrolls into view.
function picture(r, cls) {
  const box = el("div", cls);
  box.dataset.k = r.kind || "Other";
  const pic = loaded(r)?.picture;
  if (pic) {
    const img = new Image();
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.onload = () => box.classList.add("in");
    img.onerror = () => img.remove();
    img.src = pic;
    box.append(img);
  } else if (r.inside === "loading") {
    box.classList.add("ghost");
  }
  box.append(el("span", "letter", (r.site || r.host || "?").replace(/^www\./, "")[0].toUpperCase()));
  return box;
}

// ---------- The window's shape picks the layout ----------
// Wide: a grid beside the details. Tall: cards above the details. Small: cards, details over them. Grid or Cards
// can be chosen instead, and that choice is kept.
function shape() {
  const w = innerWidth, h = innerHeight;
  return w >= 760 && w >= h * 1.05 ? "side" : h >= 720 && w >= 360 ? "stack" : "over";
}
const look = () => (kept.look !== "auto" ? kept.look : shape() === "side" ? "grid" : "cards");
let lastLayout = "";
function setShape() {
  document.body.dataset.shape = shape();
  document.body.dataset.look = look();
  for (const b of document.querySelectorAll("[data-look]")) b.setAttribute("aria-pressed", String(b.dataset.look === look()));
  const now = shape() + look();
  if (state && now !== lastLayout) draw();
  lastLayout = now;
}
addEventListener("resize", setShape);
setShape();

// ---------- Searching ----------
function options() {
  return { view: $("news").checked ? "news" : "summary", when: $("when").value, exact: $("exact").checked };
}

async function search() {
  const words = $("words").value.trim();
  if (!words) return;
  await ready;
  closeMenus();
  $("words").blur(); // so Up and Down move through the results
  const engine = kept.engine;
  const opts = { ...options(), private: $("private").checked };
  showResults();
  state = { id: String(Date.now()), words, engine, opts, at: Date.now(), summary: null, rows: [], ads: 0, failed: {}, busy: true, sel: null };
  pos = -1;
  drawActive();
  draw();
  const s = state;
  const which = engine === "all" ? ENGINES : [engineOf(engine)];
  const answers = await Promise.all(which.map(e => askEngine(e, words, opts).catch(err => ({ error: err.message || String(err) }))));
  if (s !== state) return;
  s.busy = false;
  answers.forEach((a, i) => {
    const e = which[i];
    if (a.error) s.failed[e.id] = a.error;
    else if (a.check) s.failed[e.id] = "check:" + a.tabId;
    else if (a.unreadable) s.failed[e.id] = "unreadable:" + a.url;
    else merge(s, e.id, a.results);
    if (a.summary?.paragraphs?.length && opts.view !== "news") s.summary = a.summary;
    if (a.ads) s.ads += a.ads;
  });
  if (!s.rows.length && !s.summary) return failedMessage(s);
  s.sel = s.summary ? "summary" : visible()[0]?.key ?? null;
  keep(s);
  draw();
  fill(s);
}

async function askEngine(e, words, opts) {
  if (e.id !== "google") return ask({ type: e.id, words });
  const page = await ask({ type: "google", words, opts: { ...opts, debug: DEBUG, never: kept.never } });
  console.log("Landmax Search:", page.check ? "Google's check" : `${page.results.length} results, summary ${!!page.summary}`);
  if (DEBUG) console.log("LANDMAX-PAGE " + btoa(unescape(encodeURIComponent(JSON.stringify(page)))));
  return page;
}

// One row per page, whichever engines found it; each engine's place is kept ("Google #2 · Brave #1").
function merge(s, engine, results) {
  results.forEach((r, i) => {
    const key = keyOf(r.href);
    const same = s.rows.find(x => x.key === key);
    if (same) {
      same.found[engine] = i + 1;
      same.date ||= r.date;
      same.age ??= ageOf(r.date);
    } else if (!kept.never.includes(r.host)) {
      s.rows.push({ ...r, key, found: { [engine]: i + 1 }, age: ageOf(r.date), kind: "", inside: null });
    }
  });
}

function failedMessage(s) {
  const kids = [];
  for (const [id, why] of Object.entries(s.failed)) {
    const e = engineOf(id);
    if (why.startsWith("check:")) {
      kids.push(el("p", null, `${e.name} wants to check that a person is searching, not a program. Answer its check yourself; your search continues after it.`),
        button("primary", "Show Google's check", () => ask({ type: "showCheck", tabId: +why.slice(6) })));
    } else if (why.startsWith("unreadable:")) {
      kids.push(el("p", null, `Search couldn't read ${e.name}'s answer this time: it sent a page laid out in a way Search doesn't know yet. A copy is kept on this computer so it can be fixed.`),
        button("primary", `See ${e.name}'s own page in Reader`, () => ask({ type: "open", url: why.slice(11) })));
    } else {
      kids.push(el("p", null, `${e.name} didn't answer: ${why}`));
    }
  }
  if (!kids.length) kids.push(el("p", null, "Nothing found. Try fewer words, or another engine."));
  // One click to the same words elsewhere.
  const others = el("div", "acts center");
  for (const e of ENGINES.filter(x => x.id !== s.engine)) {
    const b = button("plain", "", () => pickEngine(e.id, true));
    b.append(icon(e, "eicon small"), ` Search ${e.name} instead`);
    others.append(b);
  }
  kids.push(others);
  message(kids);
}

// Kinds from the address; then (with Look inside) the page itself, row by row as it arrives; then JEV, once, for
// opinion or reporting, selling, and kinds the pages didn't give. The kept search is updated as they arrive.
async function fill(s) {
  await Promise.all(
    s.rows.map(async row => {
      row.kind ||= await ask({ type: "kindOfHost", host: row.host || "" });
      if (!kept.inside || row.inside || !/^https?:/.test(row.href)) return;
      row.inside = "loading";
      if (s === state) refresh(row);
      const got = await ask({ type: "enrich", url: row.href });
      const was = row.key;
      row.inside = got;
      // A coded Google link now has its real address: open it directly from here on.
      if (got.realUrl && /google\.[a-z.]+\/(url|goto)/.test(row.href)) {
        row.href = got.realUrl;
        row.host = new URL(got.realUrl).hostname.replace(/^www\./, "");
        if (!row.site || /(^|\.)google\.[a-z.]+$/.test(row.site)) row.site = row.host;
        row.key = keyOf(got.realUrl);
        if (s.sel === was) s.sel = row.key;
      }
      if (got.kind) row.kind = got.kind;
      if (row.age == null && got.published) row.age = ageOf("", got.published);
      if (s === state) refresh(row, was);
    })
  );
  // JEV never runs in Private: it would learn the search.
  if (!s.opts.private && s.rows.length) {
    s.judging = true;
    if (s === state) drawDetail();
    try {
      const got = await ask({
        type: "judge",
        rows: s.rows.map((r, i) => ({
          id: i, title: r.title, site: r.site, snippet: r.snippet,
          description: loaded(r)?.description || "", kind: r.kind, needKind: !r.kind,
        })),
      });
      for (const [i, j] of Object.entries(got?.rows || {})) {
        const r = s.rows[+i];
        if (!r) continue;
        r.opinion = j.opinion;
        r.selling = j.selling;
        if (j.kind && !r.kind) {
          r.kind = j.kind;
          r.kindBy = "JEV";
        }
      }
    } catch (e) {
      console.error("Landmax Search: JEV", e);
    }
    s.judging = false;
  }
  keep(s);
  if (s === state) draw();
  if (DEBUG) console.log("LANDMAX-STATE " + btoa(unescape(encodeURIComponent(JSON.stringify(s)))));
}

browser.runtime.onMessage.addListener(msg => {
  if (msg.type === "checkDone") search();
});

// ---------- History ----------
// Every search except Private ones, newest first, with its results as seen. 100 kept; Forget removes any.
function keep(s) {
  if (s.opts.private) return;
  const entry = {
    id: s.id, words: s.words, engine: s.engine, opts: s.opts, at: s.at, summary: s.summary, ads: s.ads, failed: s.failed,
    rows: s.rows.map(r => ({ ...r, inside: r.inside === "loading" ? null : r.inside })),
  };
  const i = kept.history.findIndex(h => h.id === s.id);
  if (i >= 0) kept.history[i] = entry;
  else kept.history.unshift(entry);
  kept.history = kept.history.slice(0, 100);
  if (s === state) pos = kept.history.findIndex(h => h.id === s.id);
  save("history");
  drawNav();
}

function showKept(i) {
  const h = kept.history[i];
  if (!h) return;
  pos = i;
  state = { ...structuredClone(h), busy: false, judging: false, saved: true, sel: null };
  state.sel = state.summary ? "summary" : visible()[0]?.key ?? null;
  $("words").value = h.words;
  showResults();
  drawActive();
  draw();
}

function forget(id) {
  kept.history = kept.history.filter(h => h.id !== id);
  save("history");
  if (state?.id === id) pos = -1;
  else if (state) pos = kept.history.findIndex(h => h.id === state.id);
  drawRecent();
  drawNav();
}

function drawNav() {
  const at = state && pos >= 0 ? pos : -1;
  $("back").disabled = at < 0 ? !kept.history.length : at >= kept.history.length - 1;
  $("fwd").disabled = at <= 0;
}
$("back").onclick = () => showKept(pos < 0 ? 0 : pos + 1);
$("fwd").onclick = () => showKept(pos - 1);

// ---------- Home: the box, the engines, recent searches ----------
function showResults() {
  document.body.classList.remove("home");
  $("main").hidden = false;
  $("recent").hidden = true;
  drawNav();
}
function goHome() {
  closeMenus();
  document.body.classList.add("home");
  $("main").hidden = true;
  $("recent").hidden = false;
  $("words").value = "";
  drawRecent();
  $("words").focus();
}
$("home").onclick = goHome;

function drawEngines() {
  const row = $("engines");
  row.replaceChildren();
  for (const e of [...ENGINES, ALL]) {
    const b = button("chip", "", () => pickEngine(e.id, false), e.id === "all" ? "Ask every engine and put the results together" : `Search with ${e.name}`);
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(kept.engine === e.id));
    if (e.icon) b.append(icon(e));
    else b.append(el("span", "eicon allicon", "✦"));
    b.append(el("span", null, e.name));
    row.append(b);
  }
  const cur = engineOf(kept.engine);
  $("engine").replaceChildren(cur.icon ? icon(cur) : el("span", "eicon allicon", "✦"), el("span", "caret", "▾"));
  $("engine").title = `Searching with ${cur.name}: click to change`;
  $("words").placeholder = kept.engine === "all" ? "Search every engine" : `Search ${cur.name}`;
}
// Picking an engine on the start page just picks it; after a search, it asks that engine for the same words.
function pickEngine(id, again) {
  kept.engine = id;
  save("engine");
  drawEngines();
  closeMenus();
  if (again && $("words").value.trim()) search();
}
$("engine").onclick = e => {
  e.stopPropagation();
  const m = $("enginemenu");
  if (!m.hidden) return closeMenus();
  closeMenus();
  m.replaceChildren();
  for (const x of [...ENGINES, ALL]) {
    const b = button("mitem", "", () => pickEngine(x.id, !document.body.classList.contains("home")));
    b.append(x.icon ? icon(x) : el("span", "eicon allicon", "✦"), el("span", null, x.name));
    if (x.id === kept.engine) b.classList.add("on");
    m.append(b);
  }
  m.hidden = false;
  $("engine").setAttribute("aria-expanded", "true");
};

// Recent searches as cards, newest first; typing in the box narrows them.
function drawRecent() {
  const box = $("recent");
  box.replaceChildren();
  if (!document.body.classList.contains("home")) return;
  const words = $("words").value.trim().toLowerCase();
  const hits = kept.history.filter(h => !words || h.words.toLowerCase().includes(words)).slice(0, words ? 24 : 8);
  if (!hits.length) return;
  box.append(el("h2", null, words ? "From your searches" : "Recent searches"));
  const grid = el("div", "rgrid");
  for (const h of hits) {
    const c = el("div", "rcard");
    const top = h.rows.find(r => r.inside?.picture);
    const pic = picture(top || h.rows[0] || { site: h.words }, "rpic");
    const body = el("div", "rbody");
    const e = engineOf(h.engine);
    const meta = el("div", "rmeta");
    meta.append(e.icon ? icon(e, "eicon small") : el("span", "eicon small allicon", "✦"), el("span", null, `${sinceText(h.at)} · ${h.rows.length} results`));
    body.append(el("div", "rwords", h.words), meta);
    const open = button("ropen", "", () => showKept(kept.history.indexOf(h)), `Show "${h.words}" as you saw it`);
    open.append(pic, body);
    c.append(open, button("x", "×", () => forget(h.id), "Forget this search"));
    grid.append(c);
  }
  box.append(grid);
  if (!words) {
    box.append(button("link dimlink", "Forget all searches", () => {
      if (!confirm("Forget every search kept on this computer?")) return;
      kept.history = [];
      save("history");
      pos = -1;
      drawRecent();
      drawNav();
    }));
  }
}
$("words").addEventListener("input", drawRecent);

// ---------- Order and "only" ----------
const score = r => {
  const ranks = Object.values(r.found || {});
  return ranks.length ? Math.min(...ranks) - 0.6 * (ranks.length - 1) : 99;
};
const ORDERS = {
  rank: score,
  age: r => r.age ?? 1e9,
  read: r => loaded(r)?.readMin || 1e9,
  junk: r => loaded(r)?.junk?.trackers.length ?? 1e9,
  site: r => (r.site || "").toLowerCase(),
  trust: r => (r.opinion ?? 0.5) + (r.selling ?? 0.5) + (loaded(r)?.junk ? Math.min(1, loaded(r).junk.trackers.length / 5) : 0.5),
};
const ONLY = {
  reporting: ["Reporting only", r => r.opinion != null && r.opinion < 0.5],
  notselling: ["Not selling", r => r.selling != null && r.selling < 0.5],
  free: ["Free to read", r => loaded(r) && !loaded(r).paywall],
  clean: ["Clean pages", r => loaded(r)?.junk && !loaded(r).junk.trackers.length],
};
let flip = false; // a grid heading clicked twice sorts the other way

function visible() {
  let rows = state.rows.filter(r => !kept.never.includes(r.host));
  for (const o of only) rows = rows.filter(ONLY[o][1]);
  const f = ORDERS[order];
  const pref = r => (kept.prefer.includes(r.host) ? 0 : 1);
  return rows.sort((a, b) => {
    const x = f(a), y = f(b);
    const c = typeof x === "string" ? x.localeCompare(y) : x - y;
    return (order === "rank" ? pref(a) - pref(b) : 0) || (flip ? -c : c);
  });
}

// ---------- Drawing: the results ----------
function draw() {
  if (!state) return;
  if (!state.busy && state.sel !== "summary" && !visible().some(r => r.key === state.sel)) {
    state.sel = state.summary ? "summary" : visible()[0]?.key ?? null;
  }
  drawList();
  drawDetail();
}

function message(kids) {
  state.busy = false;
  list.replaceChildren();
  const m = el("div", "message");
  m.append(...kids);
  detail.replaceChildren(m);
  document.body.classList.add("only-detail");
}

function drawList() {
  document.body.classList.remove("only-detail");
  list.replaceChildren();
  if (state.busy) {
    const g = el("div", look() === "grid" ? "glist" : "cards");
    for (let i = 0; i < 6; i++) g.append(el("div", "item ghost"));
    list.append(g);
    return;
  }
  const rows = visible();
  list.append(look() === "grid" ? grid(rows) : cards(rows));
  if (!rows.length) list.append(el("p", "empty", state.rows.length ? "Nothing matches what Refine is showing." : "Nothing found. Try fewer words."));
  list.append(foot());
}

// The trust cues at a glance: tone, selling, junk, paywall, each a coloured dot (its words on hover).
function dots(r) {
  const d = el("span", "dots");
  const dot = (cls, title) => {
    const x = el("i", cls);
    x.title = title;
    d.append(x);
  };
  if (r.opinion != null) dot(r.opinion >= 0.5 ? "care" : "good", r.opinion >= 0.5 ? "Opinion" : "Reporting");
  if (r.selling != null) dot(r.selling >= 0.5 ? "care" : "good", r.selling >= 0.5 ? "Selling something" : "Not selling");
  const j = loaded(r)?.junk;
  if (j) dot(!j.trackers.length ? "good" : j.trackers.length > 4 ? "bad" : "care", j.trackers.length ? `${j.trackers.length} ad and tracker companies` : "Clean: no ad or tracker companies");
  if (loaded(r)?.paywall) d.append(el("span", "lock", "🔒"));
  return d;
}
function foundBy(r) {
  const f = el("span", "found");
  for (const [id, n] of Object.entries(r.found || {}).sort((a, b) => a[1] - b[1])) {
    const e = engineOf(id);
    const b = el("span", "fb");
    b.title = `${e.name}'s #${n}`;
    b.append(icon(e, "eicon tiny"), String(n));
    f.append(b);
  }
  return f;
}
function kindPill(r) {
  if (!r.kind) return "";
  const k = el("span", "kind", r.kind);
  k.dataset.k = r.kind;
  return k;
}
function add(parent, ...kids) {
  parent.append(...kids.filter(k => k !== "" && k != null));
  return parent;
}
function choose(node, key, href) {
  node.dataset.key = key;
  node.tabIndex = 0;
  node.setAttribute("aria-current", String(state.sel === key));
  node.onclick = () => select(key);
  if (href) node.ondblclick = () => openIt(href);
  return node;
}

function grid(rows) {
  const t = el("div", "glist");
  const head = el("div", "ghead");
  const h = (label, key, cls) => {
    const b = button("gh " + (cls || ""), label, () => {
      flip = order === key ? !flip : false;
      order = key;
      $("order").value = ORDERS[key] && $("order").querySelector(`[value="${key}"]`) ? key : "rank";
      drawActive();
      draw();
    }, "Sort by this");
    if (order === key) b.classList.add("on", flip ? "down" : "up");
    return b;
  };
  head.append(el("span", "c-pic"), h("Result", "site", "c-what"), h("Age", "age", "c-age"), h("Read", "read", "c-read"), h("Trust", "trust", "c-trust"), h("Found", "rank", "c-found"));
  t.append(head);
  if (state.summary) {
    const s = choose(el("div", "item grow sum"), "summary");
    const what = el("div", "c-what");
    what.append(add(el("div", "site"), el("span", "fav spark", "✦"), el("span", "name", "Google's summary")), el("div", "title", firstLine(state.summary)));
    s.append(el("span", "c-pic spark-pic", "✦"), what);
    t.append(s);
  }
  for (const r of rows) {
    const g = choose(el("div", "item grow"), r.key, r.href);
    g.dataset.k = r.kind || "Other";
    const site = add(el("div", "site"), favicon(r), el("span", "name", r.site || r.host || ""), kindPill(r), kept.prefer.includes(r.host) ? el("span", "star", "★") : "");
    const what = el("div", "c-what");
    what.append(site, el("div", "title", r.title));
    g.append(picture(r, "c-pic thumb"), what, el("span", "c-age", ageText(r.age, true)), el("span", "c-read", loaded(r)?.readMin ? `${loaded(r).readMin} min` : ""),
      add(el("span", "c-trust"), dots(r)), add(el("span", "c-found"), foundBy(r)));
    t.append(g);
  }
  return t;
}

function cards(rows) {
  const w = el("div", "cards");
  if (state.summary) {
    const s = choose(el("div", "item card sum"), "summary");
    s.append(add(el("div", "site"), el("span", "fav spark", "✦"), el("span", "name", "Google's summary")), el("div", "title", firstLine(state.summary)));
    w.append(s);
  }
  for (const r of rows) {
    const c = choose(el("div", "item card"), r.key, r.href);
    c.dataset.k = r.kind || "Other";
    const meta = add(el("div", "cmeta"), kindPill(r), r.age != null ? el("span", "age", ageText(r.age, true)) : "", dots(r), foundBy(r));
    const site = add(el("div", "site"), favicon(r), el("span", "name", r.site || r.host || ""), kept.prefer.includes(r.host) ? el("span", "star", "★") : "");
    c.append(picture(r, "cpic"), site, el("div", "title", r.title), meta);
    w.append(c);
  }
  return w;
}
const firstLine = s => s.paragraphs.find(p => !p.startsWith("• ")) || s.paragraphs[0];

// One row changed (its look inside arrived): redraw just that row or card, and the details if it's the chosen one.
function refresh(r, was = r.key) {
  const old = list.querySelector(`.item[data-key="${CSS.escape(was)}"]`);
  if (old && !state.busy) {
    const fresh = (look() === "grid" ? grid([r]) : cards([r])).querySelector(`.item[data-key="${CSS.escape(r.key)}"]`);
    if (fresh) old.replaceWith(fresh);
  }
  if (state.sel === r.key) drawDetail();
}

function foot() {
  const f = el("div", "foot");
  const n = visible().length;
  const bits = [`${n} result${n === 1 ? "" : "s"}`];
  if (state.ads) bits.push(`${state.ads} ad${state.ads === 1 ? "" : "s"} left out`);
  f.append(el("span", "count", bits.join(" · ")));
  for (const [id, why] of Object.entries(state.failed || {})) {
    const e = engineOf(id);
    if (why.startsWith("check:")) f.append(button("link", `${e.name} wants a check: answer it`, () => ask({ type: "showCheck", tabId: +why.slice(6) })));
    else f.append(el("span", "count", `${e.name} didn't answer`));
  }
  if (state.engine === "google" || state.engine === "all") {
    const news = state.opts.view === "news";
    f.append(button("link", news ? "All results, not just news" : "Recent news about this", () => {
      $("news").checked = !news;
      $("news").dataset.touched = "1";
      $("words").value = state.words;
      search();
    }));
  }
  return f;
}

// ---------- Choosing ----------
function select(key) {
  state.sel = key;
  for (const x of list.querySelectorAll(".item[data-key]")) x.setAttribute("aria-current", String(x.dataset.key === key));
  document.body.classList.add("picked");
  drawDetail();
  detail.scrollTop = 0;
}
const chosen = () => state.rows.find(r => r.key === state.sel);
const openIt = url => ask({ type: "open", url });

// ---------- Drawing: the details ----------
function drawDetail() {
  if (!state || document.body.classList.contains("only-detail")) return;
  detail.replaceChildren();
  if (state.busy) {
    detail.append(el("div", "ghost bigpic"), el("div", "ghost line w60"), el("div", "ghost line w90"), el("div", "ghost line w80"));
    return;
  }
  if (shape() === "over") detail.append(button("back", "‹ Results", () => document.body.classList.remove("picked")));
  if (state.saved) {
    const note = el("p", "kept");
    note.append(`Kept from ${new Date(state.at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. `,
      button("link", "Search again for fresh results", () => {
        $("words").value = state.words;
        search();
      }));
    detail.append(note);
  }
  if (state.sel === "summary" && state.summary) return detail.append(summaryDetail(state.summary));
  const r = chosen();
  if (!r) return detail.append(el("p", "empty", "Choose a result to see more about it."));
  const inside = loaded(r);

  if (inside?.picture) {
    const pic = el("div", "bigpic");
    const img = new Image();
    img.alt = "";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => pic.remove();
    img.onload = () => pic.classList.add("in");
    img.src = inside.picture;
    pic.append(img);
    detail.append(pic);
  } else if (r.inside === "loading") {
    detail.append(el("div", "ghost bigpic"));
  }

  const kicker = el("div", "kicker");
  kicker.dataset.k = r.kind || "Other";
  add(kicker, favicon(r), el("span", "name", r.site || r.host || ""), kindPill(r));
  detail.append(kicker, el("h2", "title", r.title));

  const by = [];
  if (inside?.author && inside.author.toLowerCase() !== (r.site || "").toLowerCase()) by.push(inside.author);
  if (r.age != null) by.push(ageText(r.age));
  if (inside?.readMin) by.push(`${inside.readMin} min read`);
  if (by.length) detail.append(el("p", "by", by.join(" · ")));
  detail.append(el("p", "desc", inside?.description || r.snippet || ""));

  const acts = el("div", "acts");
  acts.append(
    button("primary", "Open", () => openIt(r.href), "Open the page in Reader"),
    button("plain", "Just the text", () => openIt("about:reader?url=" + encodeURIComponent(r.href)), "Open only the words and pictures, without the rest of the page"),
    button("plain", "Copy link", e => {
      navigator.clipboard.writeText(cleanLink(r.href)).then(() => {
        e.target.textContent = "Copied";
        setTimeout(() => (e.target.textContent = "Copy link"), 1500);
      });
    }, "Copy the address, without the tracking added to it")
  );
  detail.append(acts, el("p", "addr", cleanLink(r.href)));
  detail.append(el("h3", null, "About this page"), facts(r));

  if (r.host?.includes(".")) {
    const sites = el("div", "sitebtns");
    const preferred = kept.prefer.includes(r.host);
    sites.append(
      button("link", preferred ? `Stop preferring ${r.host}` : `Prefer ${r.host}`, () => {
        kept.prefer = preferred ? kept.prefer.filter(h => h !== r.host) : [...kept.prefer, r.host];
        save("prefer");
        drawSites();
        draw();
      }, "Preferred sites come first in every search"),
      button("link", `Never show ${r.host}`, () => {
        kept.never.push(r.host);
        save("never");
        drawSites();
        draw();
      })
    );
    detail.append(sites);
  }
}

// Why to trust the page or not, in plain sentences, each with a colour: good, careful, or bad.
function facts(r) {
  const ul = el("ul", "facts");
  const fact = (tone, text, title) => {
    const li = el("li", tone, text);
    if (title) li.title = title;
    ul.append(li);
    return li;
  };
  const inside = loaded(r);
  if (r.opinion != null) {
    r.opinion >= 0.5
      ? fact("care", "Opinion: mainly someone's view", `JEV: ${Math.round(r.opinion * 100)}% likely to be opinion`)
      : fact("good", "Reporting: mainly facts", `JEV: ${Math.round(r.opinion * 100)}% likely to be opinion`);
    r.selling >= 0.5
      ? fact("care", "Trying to sell you something", `JEV: ${Math.round(r.selling * 100)}% likely`)
      : fact("good", "Not selling anything", `JEV: ${Math.round(r.selling * 100)}% likely to be selling`);
  } else if (state.judging) {
    fact("wait", "JEV is reading it…");
  }
  if (r.inside === "loading") {
    fact("wait", "Looking inside the page…");
  } else if (inside?.failed) {
    fact("wait", "Couldn't look inside: " + inside.failed);
  } else if (inside) {
    if (inside.paywall) fact("care", "Behind a paywall: you may need to subscribe");
    const j = inside.junk;
    if (j) {
      const sizes = `${j.kb} KB of page code, ${j.scripts} scripts from ${j.hosts} other sites`;
      // One name per company ("googletagmanager.com" and "googletagmanager" are the same one).
      const names = [...new Set(j.trackers.map(t => t.replace(/\.(com|net|org|io|co|ai)$/, "")))];
      if (!names.length) fact("good", "Clean: no ad or tracker companies", sizes);
      else fact(names.length > 4 ? "bad" : "care", `${names.length} ad and tracker compan${names.length === 1 ? "y" : "ies"}: ${names.join(", ")}`, sizes);
    }
  } else if (!kept.inside) {
    fact("wait", "Turn on Look inside (in Refine) to learn more about it");
  }
  const found = Object.entries(r.found || {}).sort((a, b) => a[1] - b[1]);
  if (found.length) {
    const li = fact("info", "Found by ");
    found.forEach(([id, n], i) => {
      const e = engineOf(id);
      if (i) li.append(" · ");
      li.append(icon(e, "eicon tiny"), ` ${e.name} #${n}`);
    });
    if (found.length > 1) li.append(" — more than one engine agrees");
  }
  if (state.summary?.sources.some(s => keyOf(s.href).split("/")[0] === r.host)) fact("info", "Google's summary cites this site");
  return ul;
}

function summaryDetail(s) {
  const box = el("section", "summary");
  const kicker = el("div", "kicker");
  kicker.append(el("span", "fav spark", "✦"), el("span", "name", "Google's summary"), el("span", "kind ai", "Written by Google's AI: it can be wrong"));
  box.append(kicker);
  for (const t of s.paragraphs) {
    const kind = t.startsWith("• ") ? "bullet" : t.length < 60 && !/[.:!?]$/.test(t) ? "head" : null;
    box.append(el("p", kind, kind === "bullet" ? t.slice(2) : t));
  }
  if (s.sources.length) {
    box.append(el("h3", null, "Its sources"));
    const ul = el("ul", "sources");
    for (const src of s.sources) {
      const li = el("li");
      const match = state.rows.find(r => keyOf(r.href).split("/")[0] === keyOf(src.href).split("/")[0]);
      li.append(button("link", src.name, () => (match ? select(match.key) : openIt(src.href)), match ? "Show this result" : "Open it in Reader"));
      ul.append(li);
    }
    box.append(ul);
  }
  return box;
}

// ---------- Refine ----------
// What Google is asked for waits for "Search again"; what's shown changes at once. Only what's on shows, as one
// quiet line under the box.
function drawActive() {
  const box = $("active");
  box.replaceChildren();
  const on = [];
  const o = state?.opts || options();
  if (o.when) on.push([$("when").selectedOptions[0].text, () => ($("when").value = "") || true]);
  if (o.exact) on.push(["Exact words", () => !($("exact").checked = false)]);
  if (o.view === "news") on.push(["News only", () => !($("news").checked = false)]);
  if (order !== "rank") on.push([`Sorted: ${({ age: "newest", read: "shortest read", junk: "least junk", site: "site", trust: "most trusted" })[order]}`, () => ((order = "rank"), ($("order").value = "rank"), (flip = false), false)]);
  for (const k of only) on.push([ONLY[k][0], () => (only.delete(k), syncOnly(), false)]);
  for (const [label, clear] of on) {
    box.append(button("on", label + "  ×", () => {
      const again = clear();
      drawActive();
      again && state ? search() : draw();
    }, "Turn this off"));
  }
  box.hidden = !on.length;
}
function syncOnly() {
  for (const c of document.querySelectorAll("[data-only]")) c.checked = only.has(c.dataset.only);
}
function searchChanged() {
  if (!state) return false;
  const o = options();
  return o.when !== state.opts.when || o.exact !== state.opts.exact || o.view !== state.opts.view;
}
function closeMenus() {
  $("pop").hidden = true;
  $("refine").setAttribute("aria-expanded", "false");
  $("enginemenu").hidden = true;
  $("engine").setAttribute("aria-expanded", "false");
}
function drawSites() {
  const box = $("sites");
  box.replaceChildren();
  for (const [label, key] of [["Preferred", "prefer"], ["Never shown", "never"]]) {
    if (!kept[key].length) continue;
    const row = el("div", "row sitelist");
    row.append(el("span", null, label + ":"));
    for (const h of kept[key]) {
      row.append(button("on", h + "  ×", () => {
        kept[key] = kept[key].filter(x => x !== h);
        save(key);
        drawSites();
        draw();
      }, `Take ${h} off this list`));
    }
    box.append(row);
  }
}

$("refine").onclick = () => {
  const open = $("pop").hidden;
  closeMenus();
  $("pop").hidden = !open;
  $("refine").setAttribute("aria-expanded", String(open));
};
addEventListener("mousedown", e => {
  if (!e.target.closest("#pop, #refine, #enginemenu, #engine")) closeMenus();
});
for (const id of ["when", "exact", "news"]) {
  $(id).onchange = () => {
    if (id === "news") $("news").dataset.touched = "1";
    $("again").hidden = !searchChanged();
    if (!state) drawActive();
  };
}
$("again").onclick = () => {
  $("again").hidden = true;
  $("words").value ||= state?.words || "";
  search();
};
$("order").onchange = () => {
  order = $("order").value;
  flip = false;
  drawActive();
  draw();
};
for (const c of document.querySelectorAll("[data-only]")) {
  c.onchange = () => {
    c.checked ? only.add(c.dataset.only) : only.delete(c.dataset.only);
    drawActive();
    draw();
  };
}
$("inside").onchange = () => {
  kept.inside = $("inside").checked;
  save("inside");
  if (state && !state.busy && !state.saved) {
    draw();
    fill(state);
  }
};
for (const b of document.querySelectorAll("[data-look]")) {
  b.onclick = () => {
    // Choosing what the window would pick anyway goes back to automatic.
    kept.look = b.dataset.look === (shape() === "side" ? "grid" : "cards") ? "auto" : b.dataset.look;
    save("look");
    setShape();
  };
}

// ---------- The box ----------
$("form").addEventListener("submit", e => {
  e.preventDefault();
  $("again").hidden = true;
  if (!$("news").dataset.touched) $("news").checked = newsy($("words").value);
  search();
});
// Private changes only the next search: what's on screen stays, and private searches aren't kept.
$("private").onchange = async () => {
  document.body.classList.toggle("is-private", $("private").checked);
  if (!$("private").checked) await ask({ type: "endPrivate" });
  $("words").focus();
};

// Up and Down move through the results, Enter opens the chosen page; Escape closes menus or the details.
addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (!$("pop").hidden || !$("enginemenu").hidden) closeMenus();
    else document.body.classList.remove("picked");
    return;
  }
  if (!state || state.busy || e.target.matches("input, select") || !["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
  const keys = [...list.querySelectorAll(".item[data-key]")].map(x => x.dataset.key);
  if (e.key === "Enter") {
    const r = chosen();
    const on = e.target.closest?.(".item");
    if (on && on.dataset.key !== state.sel) return select(on.dataset.key);
    if (r) {
      e.preventDefault();
      openIt(r.href);
    }
    return;
  }
  e.preventDefault();
  const i = keys.indexOf(state.sel);
  const next = keys[Math.max(0, Math.min(keys.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
  if (next) {
    select(next);
    list.querySelector(`.item[data-key="${CSS.escape(next)}"]`)?.focus();
  }
});

// For tests: draw a saved search without asking any engine.
window.landmaxShow = s => {
  state = { failed: {}, engine: "google", at: Date.now(), ...s };
  $("words").value = s.words;
  showResults();
  drawActive();
  draw();
};
window.landmaxKeep = entries => {
  kept.history = entries;
  drawRecent();
  drawNav();
};

// Opened with ?q= (landmax-search <words>): run that one search.
if (params.get("when")) $("when").value = params.get("when");
if (params.get("view") === "news") {
  $("news").checked = true;
  $("news").dataset.touched = "1";
}
const asked = params.get("q");
if (asked) {
  $("words").value = asked;
  if (!$("news").dataset.touched) $("news").checked = newsy(asked);
  ready.then(search);
}
drawNav();
