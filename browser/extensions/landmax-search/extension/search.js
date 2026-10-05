"use strict";
// The Search panel (docs/search-plan.md). Every search starts from a click or Enter: nothing runs on its own.

const $ = id => document.getElementById(id);
const out = $("out");
const ask = msg => browser.runtime.sendMessage(msg);

let view = null; // "summary" or "web"; null = picked from the words
let last = null; // the last search: { words, opts, page }

// "Never show" and "Prefer" sites, kept on this computer (shared between Library users later).
const sites = { never: [], prefer: [] };
browser.storage.local.get(["never", "prefer"]).then(s => {
  sites.never = s.never || [];
  sites.prefer = s.prefer || [];
});
function saveSites() {
  return browser.storage.local.set({ never: sites.never, prefer: sites.prefer });
}

// A question gets Google's summary (Google writes one mostly for questions); a few words get plain links.
function pickView(words) {
  const w = words.trim().toLowerCase();
  const question = /\?$/.test(w) || /^(how|what|why|when|where|who|which|is|are|can|does|do|should|will)\b/.test(w);
  return question || w.split(/\s+/).length >= 5 ? "summary" : "web";
}

function showView(v) {
  for (const b of document.querySelectorAll(".views button")) {
    b.setAttribute("aria-pressed", String(b.dataset.view === v));
  }
}

function opts() {
  return {
    view: view || pickView($("words").value),
    when: $("when").value,
    exact: $("exact").checked,
    private: $("private").checked,
    never: sites.never,
  };
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) {
    e.className = cls;
  }
  if (text != null) {
    e.textContent = text;
  }
  return e;
}

function note(text, warn) {
  out.replaceChildren(el("p", "note" + (warn ? " warn" : ""), text));
}

async function search() {
  const words = $("words").value.trim();
  if (!words) {
    return;
  }
  const o = opts();
  showView(o.view);
  note("Searching…");
  try {
    const page = await ask({ type: "google", words, opts: o });
    last = { words, opts: o, page };
    console.log("Landmax Search:", page.check ? "Google's check" : `${page.results.length} results, summary ${!!page.summary}`);
    $("sent").hidden = false;
    $("sent").textContent = "Google sees: " + page.sent;
    if (page.check) {
      showCheck(page.tabId);
      return;
    }
    draw(page);
  } catch (e) {
    console.error("Landmax Search:", e);
    note("Google didn't answer: " + e.message, true);
  }
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

// A finished check comes back here (background.js), and the search runs again.
browser.runtime.onMessage.addListener(msg => {
  if (msg.type === "checkDone") {
    search();
  }
});

function draw(page) {
  out.replaceChildren();
  if (page.summary && page.summary.paragraphs.length) {
    out.append(summaryBlock(page.summary));
  }
  const results = order(page.results);
  if (!results.length && !page.summary) {
    out.append(el("p", "note", "Nothing found. Try fewer words, or Any time."));
  }
  for (const r of results) {
    out.append(card(r));
  }
  const also = el("button", "also", "Also ask DuckDuckGo");
  also.title = "One more search, at DuckDuckGo; its results appear below Google's";
  also.onclick = () => duck(also);
  out.append(also);
  const spared = [];
  if (page.ads) {
    spared.push(page.ads + (page.ads === 1 ? " ad" : " ads") + " removed");
  }
  spared.push("Google's own boxes and tracking links left out");
  out.append(el("p", "spared", spared.join(" · ")));
}

// Preferred sites first; never-show sites are already left out by Google (-site:).
function order(results) {
  const pref = r => (sites.prefer.includes(r.host) ? 0 : 1);
  return [...results].sort((a, b) => pref(a) - pref(b));
}

function summaryBlock(s) {
  const box = el("section", "summary folded");
  box.append(el("h2", null, "Google's summary · may be wrong"));
  for (const t of s.paragraphs) {
    // A short line without a full stop is one of Google's headings.
    const kind = t.startsWith("• ") ? "bullet" : t.length < 60 && !/[.:!?]$/.test(t) ? "head" : null;
    box.append(el("p", kind, t));
  }
  if (s.paragraphs.length > 4) {
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

function card(r, both) {
  const c = $("card").content.firstElementChild.cloneNode(true);
  if (r.icon) {
    c.querySelector("img").src = r.icon;
  }
  c.querySelector(".name").textContent = r.site;
  c.querySelector(".date").textContent = r.date || "";
  c.querySelector(".title").textContent = r.title;
  c.querySelector(".snippet").textContent = r.snippet;
  c.querySelector(".address").textContent = r.address || "";
  if (both) {
    c.querySelector(".name").append(el("span", "badge", "both found this"));
  }
  c.querySelector(".open").onclick = () => ask({ type: "open", url: r.href || r.url });
  const host = r.host && r.host.includes(".") ? r.host : null;
  if (!host) {
    c.querySelector(".card-tools").remove();
    return c;
  }
  if (sites.prefer.includes(host)) {
    c.classList.add("preferred");
  }
  c.querySelector(".prefer").onclick = async () => {
    sites.prefer = sites.prefer.includes(host) ? sites.prefer.filter(h => h !== host) : [...sites.prefer, host];
    await saveSites();
    draw(last.page);
  };
  c.querySelector(".never").onclick = async () => {
    if (!sites.never.includes(host)) {
      sites.never.push(host);
    }
    await saveSites();
    last.page.results = last.page.results.filter(x => x.host !== host);
    draw(last.page);
  };
  return c;
}

async function duck(button) {
  button.disabled = true;
  button.textContent = "Asking DuckDuckGo…";
  try {
    const { results } = await ask({ type: "duck", words: last.words });
    const googleHosts = new Set(last.page.results.map(r => r.host));
    const box = el("section", "duck");
    box.append(el("h2", null, "DuckDuckGo"));
    if (!results.length) {
      box.append(el("p", "note", "DuckDuckGo didn't answer this time."));
    }
    for (const r of results) {
      if (sites.never.includes(r.site)) {
        continue;
      }
      box.append(card({ ...r, host: r.site, address: r.site }, googleHosts.has(r.site)));
    }
    button.replaceWith(box);
  } catch (e) {
    button.disabled = false;
    button.textContent = "Also ask DuckDuckGo (it didn't answer: try again)";
  }
}

$("form").addEventListener("submit", e => {
  e.preventDefault();
  view = null;
  search();
});
for (const b of document.querySelectorAll(".views button")) {
  b.onclick = () => {
    view = b.dataset.view;
    search();
  };
}
$("when").onchange = () => $("words").value.trim() && search();
$("exact").onchange = () => $("words").value.trim() && search();
$("private").onchange = async () => {
  document.body.classList.toggle("is-private", $("private").checked);
  if (!$("private").checked) {
    await ask({ type: "endPrivate" });
  }
  out.replaceChildren(
    el("p", "hint", $("private").checked ? "Private: signed out, nothing remembered." : "Signed in again.")
  );
};

// Opened with ?q= (landmax-search <words>): run that one search.
const asked = new URLSearchParams(location.search).get("q");
if (asked) {
  $("words").value = asked;
  search();
}
