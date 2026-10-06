"use strict";
// The Search panel (docs/search-plan.md): Google's answer as a grid you sort and filter (a wide window) or as
// picture cards (a tall one). Every search starts from a click or Enter; nothing runs on its own. Looking inside
// the results (pictures, read time, junk) and JEV's judgements happen once per search, for its own results only.

const $ = id => document.getElementById(id);
const out = $("out");
const ask = msg => browser.runtime.sendMessage(msg);
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");

// ---------- State ----------
let view = params.get("view") || null; // "summary", "web", "news"; null = picked from the words
let look = "auto"; // "auto", "grid" or "cards"
let sort = { key: "rank", up: true };
let filters = new Set(); // "kind:News", "age:d", "age:w", "free", "clean", "both", "reporting", "notselling"
let state = null; // { words, view, summary, rows, ads, duck, judging }

// "Never show" and "Prefer" sites, saved views and the switches, kept on this computer.
const kept = { never: [], prefer: [], views: [], inside: true, look: "auto" };
const ready = browser.storage.local.get(["never", "prefer", "views", "inside", "look"]).then(s => {
  kept.never = s.never || [];
  kept.prefer = s.prefer || [];
  kept.views = s.views || [];
  kept.inside = s.inside !== false;
  look = kept.look = params.get("look") || s.look || "auto";
  $("inside").checked = kept.inside;
  pressed(".seg [data-look]", b => b.dataset.look === look);
  drawViews();
});
const save = () =>
  browser.storage.local.set({ never: kept.never, prefer: kept.prefer, views: kept.views, inside: kept.inside, look });

// ---------- Library's colours ----------
// The panel wears the person's Library theme (colors.toml, through Library's helper); its own colours otherwise.
ask({ type: "theme" })
  .then(({ colours: c } = {}) => {
    if (!c || !c.background) return;
    const set = (name, value) => value && document.documentElement.style.setProperty(name, value);
    set("--bg", c.background);
    set("--panel", c.lighter_background);
    set("--raise", c.selection);
    set("--line", c.muted || c.selection);
    set("--line-soft", c.selection);
    set("--ink", c.foreground);
    set("--dim", c.dark_foreground);
    set("--faint", `color-mix(in srgb, ${c.dark_foreground} 62%, ${c.background})`);
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
function note(text, warn) {
  out.replaceChildren(el("p", "note" + (warn ? " warn" : ""), text));
}
function pressed(sel, test) {
  for (const b of document.querySelectorAll(sel)) b.setAttribute("aria-pressed", String(test(b)));
}
// Auto: cards in a tall window (a portrait zone), a grid in a wide one.
const shown = () => (look !== "auto" ? look : innerWidth < innerHeight * 1.05 || innerWidth < 720 ? "cards" : "grid");

// A question gets Google's summary (Google writes one mostly for questions); a few words get plain results.
function pickView(words) {
  const w = words.trim().toLowerCase();
  const question = /\?$/.test(w) || /^(how|what|why|when|where|who|which|is|are|can|does|do|should|will)\b/.test(w);
  return question || w.split(/\s+/).length >= 5 ? "summary" : "web";
}

// Age in minutes from Google's words ("3 hours ago", "Mar 31, 2026") or the page's own date.
function ageOf(text, iso) {
  const m = /(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago/i.exec(text || "");
  if (m) return +m[1] * { minute: 1, hour: 60, day: 1440, week: 10080, month: 43200, year: 525600 }[m[2].toLowerCase()];
  const t = Date.parse(text || "") || Date.parse(iso || "");
  return t ? Math.max(0, Math.round((Date.now() - t) / 60000)) : null;
}
function ageText(min) {
  if (min == null) return "";
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  if (min < 43200) return `${Math.round(min / 1440)} d`;
  if (min < 525600) return `${Math.round(min / 43200)} mo`;
  return `${Math.round(min / 525600)} y`;
}
// Fresh is bright: today, this week, this month, older.
const freshness = min => (min == null ? "" : min <= 1440 ? "today" : min <= 10080 ? "week" : min <= 43200 ? "month" : "old");
const junkClass = s => (s < 25 ? "clean" : s < 55 ? "some" : "heavy");
const junkWord = s => (s < 25 ? "Clean" : s < 55 ? "Some junk" : "Heavy");
const keyOf = href => {
  try {
    const u = new URL(href);
    return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "");
  } catch {
    return href;
  }
};
function kindPill(r) {
  const k = el("span", "kind", r.kind);
  k.dataset.k = r.kind;
  k.title = r.kindBy === "JEV" ? "Kind guessed by JEV from the title and snippet" : "Kind as the page itself says";
  return k;
}
// The site's own little icon: Google's copy if it sent one, else the site's (only with Look inside).
function favicon(r) {
  const src = r.icon || (kept.inside && r.host?.includes(".") ? `https://${r.host}/favicon.ico` : "");
  if (!src) return el("span", "fav none", (r.site || r.host || "?")[0].toUpperCase());
  const img = new Image(16, 16);
  img.className = "fav";
  img.referrerPolicy = "no-referrer";
  img.onerror = () => img.replaceWith(el("span", "fav none", (r.site || r.host || "?")[0].toUpperCase()));
  img.src = src;
  return img;
}

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
    if (page.unreadable) {
      state = null;
      $("stats").hidden = $("filters").hidden = true;
      out.replaceChildren(
        el("p", "note warn", "Search couldn't read Google's answer this time: Google sent a page laid out in a way it doesn't know yet."),
        el("p", "note", "A copy is kept on this computer so it can be fixed. Meanwhile, see Google's own page in Reader:")
      );
      const b = el("button", "action", "Open this search in Reader");
      b.onclick = () => ask({ type: "open", url: page.url });
      out.append(b);
      return;
    }
    state = {
      words,
      view: o.view,
      summary: o.view === "summary" ? page.summary : null,
      ads: page.ads,
      duck: "no",
      rows: page.results.map((r, i) => ({ ...r, key: keyOf(r.href), g: i + 1, d: null, age: ageOf(r.date), kind: "", inside: null })),
    };
    filters = new Set([...filters].filter(f => !f.startsWith("kind:")));
    draw();
    fill();
  } catch (e) {
    console.error("Landmax Search:", e);
    note("Google didn't answer: " + e.message, true);
  }
}

// Kinds from the address; then (with Look inside) everything from the page itself, row by row as it arrives;
// then JEV, once, for opinion or reporting, selling, and kinds the pages didn't give.
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
  // JEV never runs in Private: it would learn the search.
  if (!$("private").checked && s.rows.length) {
    s.judging = true;
    if (s === state) draw();
    try {
      const got = await ask({
        type: "judge",
        rows: s.rows.map((r, i) => ({
          id: i, title: r.title, site: r.site, snippet: r.snippet,
          description: r.inside?.description || "", kind: r.kind, needKind: !r.kind,
        })),
      });
      for (const [i, j] of Object.entries(got?.rows || {})) {
        const r = s.rows[+i];
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
  tone: r => r.opinion ?? 2,
  selling: r => r.selling ?? 2,
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
  if (filters.has("reporting")) rows = rows.filter(r => r.opinion != null && r.opinion < 0.5);
  if (filters.has("notselling")) rows = rows.filter(r => r.selling != null && r.selling < 0.5);
  const f = SORTS[sort.key];
  const pref = r => (kept.prefer.includes(r.host) ? 0 : 1);
  return rows.sort((a, b) => {
    const x = f(a), y = f(b);
    const c = typeof x === "string" ? x.localeCompare(y) : x - y;
    return (sort.key === "rank" ? pref(a) - pref(b) : 0) || (sort.up ? c : -c);
  });
}

function toggle(id) {
  filters.has(id) ? filters.delete(id) : filters.add(id);
  if (id === "age:d") filters.delete("age:w");
  if (id === "age:w") filters.delete("age:d");
  draw();
}

// The stats bar: what these results are made of, at a glance. Each kind's share is a coloured block; click to filter.
function drawStats() {
  const box = $("stats");
  if (!state || !state.rows.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.replaceChildren();
  const rows = state.rows.filter(r => !kept.never.includes(r.host));
  const count = {};
  for (const r of rows) count[r.kind || "Other"] = (count[r.kind || "Other"] || 0) + 1;
  const bar = el("div", "mix");
  for (const k of Object.keys(count).sort((a, b) => count[b] - count[a])) {
    const seg = el("button", "seg-k");
    seg.type = "button";
    seg.dataset.k = k;
    seg.style.flexGrow = count[k];
    seg.title = `${count[k]} ${k} — click to show only these`;
    seg.setAttribute("aria-pressed", String(filters.has("kind:" + k)));
    seg.append(el("span", null, `${k} ${count[k]}`));
    seg.onclick = () => toggle("kind:" + k);
    bar.append(seg);
  }
  const facts = el("div", "facts");
  const fact = (n, label, cls, title) => {
    const f = el("span", "fact " + (cls ? "f-" + cls : ""));
    f.append(el("b", null, String(n)), " " + label);
    if (title) f.title = title;
    facts.append(f);
  };
  fact(rows.length, rows.length === 1 ? "result" : "results");
  const fresh = rows.filter(r => r.age != null && r.age <= 10080).length;
  if (fresh) fact(fresh, "this week", "today");
  const judged = rows.filter(r => r.opinion != null);
  if (judged.length) {
    fact(judged.filter(r => r.opinion >= 0.5).length, "opinion", "opinion", "JEV: mainly someone's view");
    fact(judged.filter(r => r.selling >= 0.5).length, "selling", "selling", "JEV: trying to sell something");
  } else if (state.judging) {
    facts.append(el("span", "fact pending", "JEV is reading…"));
  }
  const pay = rows.filter(r => r.inside?.paywall).length;
  if (pay) fact(pay, "paywalled", "pay");
  const trackers = rows.reduce((a, r) => a + (r.inside?.junk?.trackers.length || 0), 0);
  if (trackers) fact(trackers, "trackers avoided", "heavy", "Ad and tracker companies on these pages that you'd have met");
  if (state.ads) fact(state.ads, state.ads === 1 ? "ad removed" : "ads removed");
  box.append(bar, facts);
}

function drawFilters() {
  const box = $("filters");
  if (!state) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.replaceChildren();
  const chip = (id, label) => {
    const b = el("button", "chip", label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(filters.has(id)));
    b.onclick = () => toggle(id);
    box.append(b);
  };
  // Google already limited the time when When is set; these narrow what's here.
  if (!$("when").value) {
    chip("age:d", "Last day");
    chip("age:w", "Last week");
  }
  if (kept.inside) {
    chip("free", "Free to read");
    chip("clean", "Clean only");
  }
  if (state.rows.some(r => r.opinion != null)) {
    chip("reporting", "Reporting only");
    chip("notselling", "Not selling");
  }
  if (state.duck === "done") chip("both", "Both engines");
  if (filters.size) {
    const c = el("button", "chip clear", "Clear filters");
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
      look = v.look === "wall" ? "cards" : v.look;
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
  drawStats();
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
    !rows.length ? el("p", "note", "Nothing matches. Clear a filter, or try fewer words.") : shown() === "cards" ? cards(rows) : grid(rows)
  );
}

function thumb(r) {
  const t = el("div", "thumb");
  t.dataset.k = r.kind || "Other";
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
    header("Junk", "junk", "c-junk"),
    header("Tone", "tone", "c-tone"),
    header("Selling", "selling", "c-sell"),
    header("Found", "rank", "c-found"),
    header("", null)
  );
  t.append(el("thead"), el("tbody"));
  t.tHead.append(hr);
  for (const r of rows) t.tBodies[0].append(row(r));
  return t;
}

function siteLine(r) {
  const inside = r.inside && r.inside !== "loading" ? r.inside : null;
  const site = el("div", "site");
  site.append(favicon(r), el("span", "name", r.site || r.host || ""));
  if (inside?.paywall) site.append(el("span", "lock", "🔒 paywall"));
  if (inside?.author && inside.author.toLowerCase() !== (r.site || "").toLowerCase()) site.append(el("span", "author", inside.author));
  return site;
}

function agePill(r) {
  return r.age == null ? "" : el("span", "age " + freshness(r.age), ageText(r.age));
}

function junkCell(inside) {
  const w = el("span", "junk");
  if (inside?.junk) {
    const j = inside.junk;
    w.classList.add(junkClass(j.score));
    w.title = `${junkWord(j.score)}: ${j.kb} KB of page code, ${j.scripts} scripts from ${j.hosts} other sites` +
      (j.trackers.length ? `\nAd and tracker companies: ${j.trackers.join(", ")}` : "\nNo known ad or tracker companies");
    const m = el("span", "meter");
    const bar = el("i");
    bar.style.width = Math.max(8, j.score) + "%";
    m.append(bar);
    w.append(m, el("span", "n", j.trackers.length ? String(j.trackers.length) : "0"));
  } else if (inside?.failed) {
    w.textContent = "—";
    w.title = "Couldn't look inside: " + inside.failed;
  }
  return w;
}

function tonePill(r) {
  if (r.opinion == null) return state.judging ? el("span", "pending", "…") : "";
  const t = el("span", "tone " + (r.opinion >= 0.5 ? "opinion" : "report"), r.opinion >= 0.5 ? "Opinion" : "Reporting");
  t.title = `JEV: ${Math.round(r.opinion * 100)}% likely to be opinion`;
  return t;
}
function sellPill(r) {
  if (r.selling == null) return state.judging ? el("span", "pending", "…") : "";
  const t = r.selling >= 0.5 ? el("span", "selling", "$ Selling") : el("span", "pending", "—");
  t.title = `JEV: ${Math.round(r.selling * 100)}% likely to be selling something`;
  return t;
}

function actions(r) {
  const acts = el("span", "acts");
  if (!(r.host && r.host.includes("."))) return acts;
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
  acts.append(p, n);
  return acts;
}

function row(r) {
  const tr = el("tr", "row");
  tr.dataset.k = r.kind || "Other";
  if (kept.prefer.includes(r.host)) tr.classList.add("preferred");
  tr.onclick = () => ask({ type: "open", url: r.href });
  const inside = r.inside && r.inside !== "loading" ? r.inside : null;
  const td = (cls, ...kids) => {
    const c = el("td", cls);
    c.append(...kids.filter(k => k !== ""));
    return c;
  };
  const what = td("what", siteLine(r), el("div", "title", r.title), el("div", "snippet", r.snippet || ""));
  const found = el("span", "found");
  if (r.g) found.append(el("span", "g", "G" + r.g));
  if (r.d) found.append(el("span", "d", "D" + r.d));
  tr.append(
    td("pic", thumb(r)),
    what,
    td("c-kind", r.kind ? kindPill(r) : ""),
    td("num", agePill(r)),
    td("num c-read", inside?.readMin ? `${inside.readMin} min` : ""),
    td("c-junk", junkCell(inside)),
    td("c-tone", tonePill(r)),
    td("c-sell", sellPill(r)),
    td("c-found", found),
    td("c-acts", actions(r))
  );
  return tr;
}

function cards(rows) {
  const w = el("div", "cards");
  for (const r of rows) {
    const inside = r.inside && r.inside !== "loading" ? r.inside : null;
    const c = el("article", "card");
    c.dataset.k = r.kind || "Other";
    c.onclick = () => ask({ type: "open", url: r.href });
    const body = el("div", "body");
    const meta = el("div", "meta");
    for (const x of [r.kind ? kindPill(r) : "", agePill(r), inside?.readMin ? el("span", "read", `${inside.readMin} min`) : "", junkCell(inside)]) {
      if (x !== "") meta.append(x);
    }
    if (r.opinion >= 0.5) meta.append(tonePill(r));
    if (r.selling >= 0.5) meta.append(sellPill(r));
    body.append(siteLine(r), el("div", "title", r.title), el("div", "snippet", r.snippet || ""), meta);
    c.append(thumb(r), body, actions(r));
    w.append(c);
  }
  return w;
}

function summaryBlock(s) {
  const box = el("section", "summary folded");
  box.append(el("h2", null, "Google's summary · may be wrong"));
  for (const t of s.paragraphs) {
    const kind = t.startsWith("• ") ? "bullet" : t.length < 60 && !/[.:!?]$/.test(t) ? "head" : null;
    box.append(el("p", kind, kind === "bullet" ? t.slice(2) : t));
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
  f.append(el("span", null, `${visible().length} of ${state.rows.length} shown`));
  if (state.duck === "no" || state.duck === "failed") {
    const b = el("button", "action", state.duck === "failed" ? "DuckDuckGo didn't answer: try again" : "＋ Also ask DuckDuckGo");
    b.title = "One more search, at DuckDuckGo; its results join these, marked D";
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
    save();
    pressed(".seg [data-look]", x => x.dataset.look === look);
    draw();
  };
}
// Auto follows the window: resized from tall to wide, the cards become a grid.
let lastShown = shown();
addEventListener("resize", () => {
  if (shown() !== lastShown) {
    lastShown = shown();
    draw();
  }
});
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
  $("filters").hidden = $("stats").hidden = true;
  note($("private").checked ? "Private: signed out, nothing remembered." : "Signed in again.");
};
pressed(".seg [data-look]", b => b.dataset.look === look);

// Opened with ?q= (landmax-search <words>): run that one search.
const asked = params.get("q");
if (params.get("when")) $("when").value = params.get("when");
if (params.get("look")) look = params.get("look");
if (asked) {
  $("words").value = asked;
  search();
}
