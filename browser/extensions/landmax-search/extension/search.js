"use strict";
// The Search panel (docs/search-plan.md, docs/search-next.md). Google-simple: one box, and the power behind one
// Refine button. Results are master-detail: a quiet list to pick from, and a pane that tells you about the chosen
// page (its picture, who wrote it, how long it takes, whether to trust it). The window's shape picks the layout.
// Every search starts from Enter or a button; nothing runs on its own.

const $ = id => document.getElementById(id);
const list = $("list");
const detail = $("detail");
const ask = msg => browser.runtime.sendMessage(msg);
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");

// ---------- State ----------
let state = null; // { words, opts, summary, rows, ads, duck, judging, sel }
let order = "rank";
let only = new Set(); // "reporting", "notselling", "free", "clean"

// "Never show" and "Prefer" sites and the Look inside switch, kept on this computer.
const kept = { never: [], prefer: [], inside: true };
const ready = browser.storage.local.get(["never", "prefer", "inside"]).then(s => {
  kept.never = s.never || [];
  kept.prefer = s.prefer || [];
  kept.inside = s.inside !== false;
  $("inside").checked = kept.inside;
  drawSites();
});
const save = () => browser.storage.local.set({ never: kept.never, prefer: kept.prefer, inside: kept.inside });

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
const loaded = r => (r.inside && r.inside !== "loading" ? r.inside : null);

// News when the words ask for it; otherwise Google's normal answer, with its summary when it wrote one.
const newsy = words => /\b(news|latest|today|tonight|yesterday|this week|breaking|headlines?)\b/i.test(words);

// Age in minutes from Google's words ("3 hours ago", "Mar 31, 2026") or the page's own date.
function ageOf(text, iso) {
  const m = /(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago/i.exec(text || "");
  if (m) return +m[1] * { minute: 1, hour: 60, day: 1440, week: 10080, month: 43200, year: 525600 }[m[2].toLowerCase()];
  const t = Date.parse(text || "") || Date.parse(iso || "");
  return t ? Math.max(0, Math.round((Date.now() - t) / 60000)) : null;
}
function ageText(min) {
  if (min == null) return "";
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.round(min / 60)} h ago`;
  if (min < 2880) return "yesterday";
  if (min < 43200) return `${Math.round(min / 1440)} days ago`;
  if (min < 525600) return `${Math.round(min / 43200)} mo ago`;
  return `${Math.round(min / 525600)} y ago`;
}
const keyOf = href => {
  try {
    const u = new URL(href);
    return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "");
  } catch {
    return href;
  }
};
// The link without the tracking that rides along on it (utm_, fbclid and friends).
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
// The site's own little icon: Google's copy if it sent one, else the site's (only with Look inside).
function favicon(r) {
  const letter = () => el("span", "fav none", (r.site || r.host || "?")[0].toUpperCase());
  const src = r.icon || (kept.inside && r.host?.includes(".") ? `https://${r.host}/favicon.ico` : "");
  if (!src) return letter();
  const img = new Image(16, 16);
  img.className = "fav";
  img.alt = "";
  img.referrerPolicy = "no-referrer";
  img.onerror = () => img.replaceWith(letter());
  img.src = src;
  return img;
}

// ---------- The window's shape picks the layout ----------
// Wide: the list beside the details. Tall: the list above the details. Small: the list, details over it.
function shape() {
  const w = innerWidth, h = innerHeight;
  return w >= 760 && w >= h * 1.05 ? "side" : h >= 720 && w >= 360 ? "stack" : "over";
}
function setShape() {
  document.body.dataset.shape = shape();
}
addEventListener("resize", setShape);
setShape();

// ---------- Searching ----------
function options() {
  return {
    debug: DEBUG,
    view: $("news").checked ? "news" : "summary",
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
  closeRefine();
  $("words").blur(); // so Up and Down move through the results
  const o = options();
  document.body.classList.remove("home");
  $("main").hidden = false;
  state = { words, opts: o, summary: null, rows: [], ads: 0, duck: "no", judging: false, sel: null, busy: true };
  drawActive();
  draw();
  try {
    const page = await ask({ type: "google", words, opts: o });
    console.log("Landmax Search:", page.check ? "Google's check" : `${page.results.length} results, summary ${!!page.summary}`);
    if (DEBUG) console.log("LANDMAX-PAGE " + btoa(unescape(encodeURIComponent(JSON.stringify(page)))));
    if (state.words !== words) return;
    if (page.check) return message(checkMessage(page.tabId));
    if (page.unreadable) {
      return message([
        el("p", null, "Search couldn't read Google's answer this time: Google sent a page laid out in a way Search doesn't know yet. A copy is kept on this computer so it can be fixed."),
        button("primary", "See Google's own page in Reader", () => ask({ type: "open", url: page.url })),
      ]);
    }
    Object.assign(state, {
      busy: false,
      summary: o.view === "news" ? null : page.summary?.paragraphs.length ? page.summary : null,
      ads: page.ads,
      rows: page.results.map((r, i) => ({ ...r, key: keyOf(r.href), g: i + 1, d: null, age: ageOf(r.date), kind: "", inside: null })),
    });
    state.sel = state.summary ? "summary" : visible()[0]?.key ?? null;
    draw();
    fill();
  } catch (e) {
    console.error("Landmax Search:", e);
    message([el("p", null, "Google didn't answer: " + e.message)]);
  }
}

// Kinds from the address; then (with Look inside) everything from the page itself, row by row as it arrives;
// then JEV, once, for opinion or reporting, selling, and kinds the pages didn't give.
async function fill() {
  const s = state;
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
        const wasSel = s.sel === row.key;
        row.href = got.realUrl;
        row.host = new URL(got.realUrl).hostname.replace(/^www\./, "");
        if (!row.site || /(^|\.)google\.[a-z.]+$/.test(row.site)) row.site = row.host;
        row.key = keyOf(got.realUrl);
        if (wasSel) s.sel = row.key;
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
  if (s === state) draw();
  if (DEBUG) console.log("LANDMAX-STATE " + btoa(unescape(encodeURIComponent(JSON.stringify(s)))));
}

function checkMessage(tabId) {
  return [
    el("p", null, "Google wants to check that a person is searching, not a program. Answer its check yourself; your search continues after it."),
    button("primary", "Show Google's check", () => ask({ type: "showCheck", tabId })),
  ];
}
browser.runtime.onMessage.addListener(msg => {
  if (msg.type === "checkDone") search();
});

async function askDuck() {
  const s = state;
  s.duck = "asking";
  drawList();
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

// ---------- Order and "only" ----------
const ORDERS = {
  rank: r => Math.min(r.g ?? 99, r.d ?? 99) + (r.g && r.d ? -0.5 : 0),
  age: r => r.age ?? 1e9,
  read: r => loaded(r)?.readMin || 1e9,
  junk: r => loaded(r)?.junk?.score ?? 1e9,
};
const ONLY = {
  reporting: ["Reporting only", r => r.opinion != null && r.opinion < 0.5],
  notselling: ["Not selling", r => r.selling != null && r.selling < 0.5],
  free: ["Free to read", r => loaded(r) && !loaded(r).paywall],
  clean: ["Clean pages", r => loaded(r)?.junk && !loaded(r).junk.trackers.length],
};

function visible() {
  let rows = state.rows.filter(r => !kept.never.includes(r.host));
  for (const o of only) rows = rows.filter(ONLY[o][1]);
  const f = ORDERS[order];
  const pref = r => (kept.prefer.includes(r.host) ? 0 : 1);
  return rows.sort((a, b) => (order === "rank" ? pref(a) - pref(b) : 0) || f(a) - f(b));
}

// ---------- Drawing: the list ----------
function draw() {
  if (!state) return;
  // The chosen result went (Refine hid it, or Never): choose the first one left.
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
    for (let i = 0; i < 6; i++) list.append(el("div", "item ghost"));
    return;
  }
  if (state.summary) list.append(summaryItem());
  const rows = visible();
  for (const r of rows) list.append(item(r));
  if (!rows.length) list.append(el("p", "empty", state.rows.length ? "Nothing matches what Refine is showing." : "Google found nothing. Try fewer words."));
  list.append(foot());
}

function summaryItem() {
  const b = el("button", "item sum");
  b.type = "button";
  b.dataset.key = "summary";
  b.setAttribute("aria-current", String(state.sel === "summary"));
  const head = el("div", "site");
  head.append(el("span", "fav spark", "✦"), el("span", "name", "Google's summary"));
  b.append(head, el("div", "title", state.summary.paragraphs.find(p => !p.startsWith("• ")) || state.summary.paragraphs[0]));
  b.onclick = () => select("summary");
  return b;
}

function item(r) {
  const b = el("button", "item");
  b.type = "button";
  b.dataset.key = r.key;
  b.dataset.k = r.kind || "Other";
  b.setAttribute("aria-current", String(state.sel === r.key));
  const site = el("div", "site");
  site.append(favicon(r), el("span", "name", r.site || r.host || ""));
  if (r.age != null) site.append(el("span", "age", "· " + ageText(r.age)));
  if (kept.prefer.includes(r.host)) site.append(el("span", "star", "★"));
  b.append(site, el("div", "title", r.title), el("div", "snip", r.snippet || ""));
  b.onclick = () => select(r.key);
  b.ondblclick = () => openIt(r.href);
  return b;
}

// One row changed (its look inside arrived): redraw just that row, and the details if it's the chosen one.
function refresh(r, was = r.key) {
  const old = list.querySelector(`.item[data-key="${CSS.escape(was)}"]`);
  if (old) old.replaceWith(item(r));
  if (state.sel === r.key) drawDetail();
}

function foot() {
  const f = el("div", "foot");
  const n = visible().length;
  const bits = [`${n} result${n === 1 ? "" : "s"}`];
  if (state.ads) bits.push(`${state.ads} ad${state.ads === 1 ? "" : "s"} left out`);
  f.append(el("span", "count", bits.join(" · ")));
  if (state.duck === "no" || state.duck === "failed") {
    f.append(button("link", state.duck === "failed" ? "DuckDuckGo didn't answer: try again" : "Also ask DuckDuckGo", askDuck,
      "One more search, at DuckDuckGo; its results join these"));
  } else if (state.duck === "asking") {
    f.append(el("span", "count", "Asking DuckDuckGo…"));
  }
  if (state.opts.view === "news") {
    f.append(button("link", "All results, not just news", () => {
      $("news").checked = false;
      search();
    }));
  } else {
    f.append(button("link", "Recent news about this", () => {
      $("news").checked = true;
      search();
    }));
  }
  return f;
}

// ---------- Choosing ----------
function select(key) {
  state.sel = key;
  for (const x of list.querySelectorAll(".item")) x.setAttribute("aria-current", String(x.dataset.key === key));
  document.body.classList.add("picked");
  drawDetail();
  detail.scrollTop = 0;
}
function chosen() {
  return state.rows.find(r => r.key === state.sel);
}
function openIt(url) {
  ask({ type: "open", url });
}

// ---------- Drawing: the details ----------
function drawDetail() {
  if (!state || document.body.classList.contains("only-detail")) return;
  detail.replaceChildren();
  if (state.busy) {
    detail.append(el("div", "ghost pic"), el("div", "ghost line w60"), el("div", "ghost line w90"), el("div", "ghost line w80"));
    return;
  }
  if (shape() === "over") detail.append(button("back", "‹ Results", () => document.body.classList.remove("picked")));
  if (state.sel === "summary" && state.summary) return detail.append(summaryDetail(state.summary));
  const r = chosen();
  if (!r) {
    detail.append(el("p", "empty", "Choose a result to see more about it."));
    return;
  }
  const inside = loaded(r);

  if (inside?.picture) {
    const pic = el("div", "pic");
    const img = new Image();
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => pic.remove();
    img.onload = () => pic.classList.add("in");
    img.src = inside.picture;
    pic.append(img);
    detail.append(pic);
  } else if (r.inside === "loading") {
    detail.append(el("div", "ghost pic"));
  }

  const kicker = el("div", "kicker");
  kicker.dataset.k = r.kind || "Other";
  kicker.append(favicon(r), el("span", "name", r.site || r.host || ""));
  if (r.kind) kicker.append(el("span", "kind", r.kind));
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
        save();
        drawSites();
        draw();
      }, "Preferred sites come first in every search"),
      button("link", `Never show ${r.host}`, () => {
        kept.never.push(r.host);
        save();
        drawSites();
        state.sel = visible()[0]?.key ?? null;
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

  const found = [];
  if (r.g) found.push(`Google's #${r.g}`);
  if (r.d) found.push(`DuckDuckGo's #${r.d}`);
  if (found.length) fact("info", "Found as " + found.join(" and "));
  if (state.summary?.sources.some(s => keyOf(s.href).split("/")[0] === r.host)) fact("info", "Google's summary cites this site");
  return ul;
}

function summaryDetail(s) {
  const box = el("section", "summary");
  const kicker = el("div", "kicker");
  kicker.append(el("span", "fav spark", "✦"), el("span", "name", "Google's summary"), el("span", "kind", "Written by Google's AI: it can be wrong"));
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
      li.append(button("link", src.name, () => (match ? select(match.key) : openIt(src.href)),
        match ? "Show this result" : "Open it in Reader"));
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
  if (order !== "rank") on.push([$("order").selectedOptions[0].text, () => (($("order").value = order = "rank"), false)]);
  for (const k of only) on.push([ONLY[k][0], () => (only.delete(k), syncOnly(), false)]);
  for (const [label, clear] of on) {
    box.append(button("on", label + "  ×", () => {
      const again = clear();
      drawActive();
      again && state ? search() : draw();
    }, "Stop " + label.toLowerCase()));
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
function openRefine() {
  $("pop").hidden = false;
  $("refine").setAttribute("aria-expanded", "true");
}
function closeRefine() {
  $("pop").hidden = true;
  $("refine").setAttribute("aria-expanded", "false");
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
        save();
        drawSites();
        draw();
      }, `Take ${h} off this list`));
    }
    box.append(row);
  }
}

$("refine").onclick = () => ($("pop").hidden ? openRefine() : closeRefine());
addEventListener("mousedown", e => {
  if (!$("pop").hidden && !$("pop").contains(e.target) && e.target !== $("refine")) closeRefine();
});
for (const id of ["when", "exact", "news"]) {
  $(id).onchange = () => {
    $("again").hidden = !searchChanged();
    if (!state) drawActive();
  };
}
$("again").onclick = () => {
  $("again").hidden = true;
  search();
};
$("order").onchange = () => {
  order = $("order").value;
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
  save();
  if (state && !state.busy) {
    draw();
    fill();
  }
};

// ---------- The box ----------
$("form").addEventListener("submit", e => {
  e.preventDefault();
  $("again").hidden = true;
  if (!$("news").dataset.touched) $("news").checked = newsy($("words").value);
  search();
});
$("news").addEventListener("change", () => ($("news").dataset.touched = "1"));
$("private").onchange = async () => {
  document.body.classList.toggle("is-private", $("private").checked);
  if (!$("private").checked) await ask({ type: "endPrivate" });
  if (state) {
    state = null;
    $("main").hidden = true;
    document.body.classList.add("home");
  }
  $("words").focus();
};

// Up and Down move through the list, Enter opens the chosen page; Escape closes Refine or the details.
addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (!$("pop").hidden) closeRefine();
    else document.body.classList.remove("picked");
    return;
  }
  if (!state || state.busy || e.target.matches("input, select") || !["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
  const keys = [...list.querySelectorAll(".item[data-key]")].map(x => x.dataset.key);
  if (e.key === "Enter") {
    // Enter on the chosen row opens it (on any other row, it chooses that row).
    const r = chosen();
    const on = e.target.closest?.(".item");
    if (r && (e.target === document.body || on?.dataset.key === r.key)) {
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

// For tests: draw a saved search without Google.
window.landmaxShow = s => {
  state = s;
  $("words").value = s.words;
  document.body.classList.remove("home");
  $("main").hidden = false;
  drawActive();
  draw();
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
  search();
}
