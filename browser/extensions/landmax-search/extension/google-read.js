"use strict";
// Reads a Google results page (run in the hidden search tab) into plain data for the panel: Google's AI summary
// with its sources, one card per result, and the number of ads left out. Google sends two layouts (checked
// 2026-10-05): a full one (links coded as /goto?url=, <cite> addresses) and a simpler one, which Reader gets
// (links as /url?q=<the real address>). This reads both, and avoids Google's class names: they change often.
// The value of the last expression goes back to the panel.

(() => {
  const clean = s => (s || "").replace(/\s+/g, " ").trim();
  const HEADINGS = "a h3, a [role='heading']";

  // Where a result link really goes: /url?q=<address> carries it; /goto?url=<code> only Google can read.
  function target(a) {
    const u = new URL(a.getAttribute("href"), location.href);
    if (/(^|\.)google\.[a-z.]+$/.test(u.hostname)) {
      if (u.pathname === "/url") {
        const q = u.searchParams.get("q") || u.searchParams.get("url");
        return q && /^https?:/.test(q) ? { href: q, real: true } : null;
      }
      return u.pathname === "/goto" ? { href: u.href, real: false } : null;
    }
    return /^https?:/.test(u.protocol) ? { href: u.href, real: true } : null;
  }
  function hostOf(href) {
    try {
      return new URL(href).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  // Google's AI summary: the block headed "AI Overview".
  let summary = null;
  let summaryBox = null;
  const head = [...document.body.querySelectorAll("*")].find(
    e => e.childElementCount <= 1 && clean(e.textContent) === "AI Overview"
  );
  if (head) {
    summaryBox = head;
    // Grow to the whole summary, but never into the results (a link with a heading) or Google's tabs.
    for (let i = 0; i < 10 && summaryBox.parentElement && clean(summaryBox.innerText).length < 400; i++) {
      const up = summaryBox.parentElement;
      if (up === document.body || up.querySelector(HEADINGS) || /\bSearch tools\b/.test(up.innerText)) {
        break;
      }
      summaryBox = up;
    }
    const sources = [];
    const seen = new Set();
    for (const a of summaryBox.querySelectorAll("a[href]")) {
      // Sources carry the site's name as a label; plain words linked inside the text ("compressor") don't.
      const name = clean(a.getAttribute("aria-label"));
      const t = target(a);
      if (!t || !name || seen.has(name) || /Opens in new tab|watch on YouTube|Learn more/i.test(name)) {
        continue;
      }
      seen.add(name);
      sources.push({ name, href: t.href });
    }
    // Paragraphs kept, including the part Google folds behind "Show more" (it's on the page, hidden). A paragraph
    // is a block of text runs (no blocks inside it); list items get a bullet. The source names Google puts after
    // each sentence ("Rewiring America +1") and its own buttons are left out.
    const names = new Set(sources.map(x => x.name));
    const noise = t =>
      !t ||
      names.has(t) ||
      /^\+\d+$/.test(t) ||
      /^·/.test(t) ||
      /^(AI Overview|Show more|Show less|Show all|YouTube|Learn more|Dive deeper.*)$/i.test(t) ||
      /^(AI responses may include mistakes|Can't generate an AI overview|If you'd like)/i.test(t);
    let paragraphs = [];
    for (const e of summaryBox.querySelectorAll("div, li")) {
      if (e.querySelector("div, li, ul, ol") || !e.querySelector(":scope > span")) {
        continue;
      }
      let t = clean(e.textContent);
      if (noise(t)) {
        continue;
      }
      if (e.closest("li")) {
        t = "• " + t;
      }
      if (!paragraphs.includes(t)) {
        paragraphs.push(t);
      }
    }
    if (!paragraphs.length) {
      paragraphs = summaryBox.innerText.split(/\n+/).map(clean).filter(t => !noise(t));
    }
    if (paragraphs.length) {
      summary = { paragraphs, sources: sources.slice(0, 8) };
    }
  }

  // One card per result: a link holding a heading (the title). Its block is the biggest ancestor that holds only
  // this one result; in it are the site, the address, the date and Google's snippet.
  const results = [];
  const seen = new Set();
  for (const h of document.body.querySelectorAll(HEADINGS)) {
    const a = h.closest("a");
    const t = target(a);
    if (!t || seen.has(t.href) || summaryBox?.contains(a)) {
      continue;
    }
    seen.add(t.href);
    let block = a;
    while (block.parentElement && block.parentElement !== document.body && block.parentElement.querySelectorAll(HEADINGS).length <= 1) {
      block = block.parentElement;
    }
    const heading = clean(h.innerText);

    // The address line: <cite> (full layout), or the line in the link holding "›" (simple layout).
    const cite = a.querySelector("cite");
    let address;
    if (cite) {
      address = clean(cite.textContent + " " + (cite.nextElementSibling?.textContent || ""));
    } else {
      const line = [...a.querySelectorAll("div, span")].find(e => e.childElementCount === 0 && e.textContent.includes("›"));
      address = clean(line?.textContent) || hostOf(t.href);
    }
    address = address.replace(/^https?:\/\//, "").replace(/^www\./, "");

    // The site's name: its own line in the link (full layout), or the end of the title ("… - Consumer Reports").
    let site = "";
    for (const span of a.querySelectorAll("span")) {
      const s = clean(span.textContent);
      if (s && !span.querySelector("cite, h3") && !span.closest("cite, h3") && !s.includes("›") && s !== heading) {
        site = s;
        break;
      }
    }
    let title = heading;
    const tail = heading.match(/^(.{12,}) [-|–] ([^-|–]{2,40})$/);
    if (!site && tail) {
      title = tail[1];
      site = tail[2];
    }

    // The snippet: the block's words outside every link, minus repeats.
    const skip = new Set([site, address, heading, "Web results", "Read more", "—", "·"]);
    const words = [];
    const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const node = walk.currentNode;
      const s = clean(node.textContent);
      if (s && !skip.has(s) && !node.parentElement.closest("a, h2, cite, style, script")) {
        words.push(s);
      }
    }
    let snippet = clean(words.join(" ").replace(/\s+([.,;:!?])/g, "$1"));
    let date = "";
    const m = snippet.match(/^((?:[A-Z][a-z]{2} \d{1,2}, \d{4})|(?:\d+ (?:minutes?|hours?|days?|weeks?) ago))\s*[—·-]?\s*/);
    if (m) {
      date = m[1];
      snippet = snippet.slice(m[0].length);
    }
    const host = t.real ? hostOf(t.href) : address.split(/[\s/›]/)[0];
    results.push({
      title,
      href: t.href,
      site: site || host,
      host,
      address,
      date,
      snippet: snippet.slice(0, 320),
      icon: block.querySelector("img[src^='data:image']")?.getAttribute("src") || "",
    });
  }

  // What was spared: the ads ("Sponsored" blocks).
  const ads =
    document.querySelectorAll("[data-text-ad]").length ||
    [...document.body.querySelectorAll("span, div")].filter(
      e => e.childElementCount === 0 && /^Sponsored\b/.test(clean(e.textContent))
    ).length;

  return { summary, results: results.slice(0, 10), ads, url: location.href };
})();
