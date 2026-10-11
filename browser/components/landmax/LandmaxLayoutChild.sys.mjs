/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Layout (landmax-library: docs/site-apps-plan.md, step 4): the widths at which a page changes its design, read from
// its style sheets' @media rules (min-width, max-width and the newer width ranges; em and rem at 16 px). Asked once
// per host by the app bar; the answer goes into the site's recipe.

const EM = 16;
// Each rule names the width where a design starts: "min-width: 768px" starts at 768, "max-width: 767px" ends at 767
// so the next design starts at 768; the same for width ranges (< and <=, > and >=). Both spellings of one switch
// point then count as one.
const RULES = [
  [/\(\s*min-width\s*:\s*([\d.]+)(px|em|rem)\s*\)/g, 0],
  [/\(\s*max-width\s*:\s*([\d.]+)(px|em|rem)\s*\)/g, 1],
  [/\(\s*width\s*>=\s*([\d.]+)(px|em|rem)\s*\)/g, 0],
  [/\(\s*width\s*>\s*([\d.]+)(px|em|rem)\s*\)/g, 1],
  [/\(\s*width\s*<=\s*([\d.]+)(px|em|rem)\s*\)/g, 1],
  [/\(\s*width\s*<\s*([\d.]+)(px|em|rem)\s*\)/g, 0],
  [/\(\s*([\d.]+)(px|em|rem)\s*<=\s*width/g, 0],
  [/\(\s*([\d.]+)(px|em|rem)\s*<\s*width/g, 1],
];

function widthsIn(mediaText) {
  const out = [];
  for (const [re, after] of RULES) {
    for (const m of mediaText.matchAll(re)) {
      const px = Math.round(parseFloat(m[1]) * (m[2] === "px" ? 1 : EM) + after);
      if (px >= 200 && px <= 4000) {
        out.push(px);
      }
    }
  }
  return out;
}

export class LandmaxLayoutChild extends JSWindowActorChild {
  receiveMessage(message) {
    if (message.name !== "LandmaxLayout:Measure") {
      return null;
    }
    const counts = new Map();
    let unreadable = 0;
    const add = text => {
      for (const px of widthsIn(text)) {
        counts.set(px, (counts.get(px) || 0) + 1);
      }
    };
    const walk = rules => {
      for (const rule of rules) {
        if (rule.media && rule.conditionText !== undefined) {
          add(rule.media.mediaText); // @media
        }
        if (rule.styleSheet && rule.media?.mediaText) {
          add(rule.media.mediaText); // @import … screen and (min-width…)
        }
        try {
          if (rule.styleSheet) {
            walk(rule.styleSheet.cssRules);
          }
          if (rule.cssRules) {
            walk(rule.cssRules); // inside @media, @supports, @layer, @container
          }
        } catch (e) {
          unreadable++;
        }
      }
    };
    for (const sheet of this.document.styleSheets) {
      if (sheet.media?.mediaText) {
        add(sheet.media.mediaText); // <link media="(min-width…)">
      }
      try {
        walk(sheet.cssRules);
      } catch (e) {
        unreadable++;
      }
    }
    const widths = [...counts].map(([px, rules]) => ({ px, rules })).sort((a, b) => a.px - b.px);
    return { widths, unreadable, viewport: this.contentWindow.innerWidth };
  }
}
