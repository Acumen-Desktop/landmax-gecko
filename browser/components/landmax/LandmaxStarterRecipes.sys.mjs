/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The recipes Reader brings (landmax-library: docs/site-apps-plan.md, step 5), merged under the person's own
// (LandmaxRecipes). Per site (base domain), a list of tweaks; each is one switch in the app's Tweaks section:
//   id, label, about    what it is, in the person's words
//   hosts               the hosts it applies to (all of the site's hosts when left out)
//   hide                CSS selectors to hide; Reader counts what they match on the page
//   css                 a style sheet, added as an author sheet (the page's own security rules don't stop it)
//   js                  a script run in a sandbox over the page, like an add-on's content script, when the page
//                       has loaded; report(n) shows "n on this page" beside the switch
//   on                  on unless the person turns it off
//   guide, open         instead of a switch: the site's own setting does it best; the words, and the page to open
// Prefer the site's own settings, roles and labels over its class names: they change least.

export const STARTER = {
  "google.com": {
    tweaks: [
      {
        id: "gmail-chat-meet",
        label: "Chat and Meet off",
        hosts: ["mail.google.com"],
        guide: "Gmail's own setting does this best: on Chat and Meet, set Chat to Off and Meet to Hide, then Save " +
          "Changes.",
        open: "https://mail.google.com/mail/u/0/#settings/chat",
      },
      {
        id: "gmail-dark",
        label: "Dark",
        hosts: ["mail.google.com"],
        guide: "Gmail's own Dark theme is the one that works everywhere in Gmail: click the gear at the top right, " +
          "then Theme: View all, pick Dark, and Save.",
      },
      {
        id: "gmail-sponsored",
        label: "Hide sponsored mail",
        about: "The ads Gmail puts at the top of Promotions and Social, marked Ad or Sponsored.",
        hosts: ["mail.google.com"],
        on: true,
        js: `
          // A sponsored row carries a label that reads exactly "Ad" or "Sponsored" (Gmail's class names change).
          const LABELS = new Set(["Ad", "Sponsored"]);
          const sponsored = row => [...row.querySelectorAll("span, div")]
            .some(el => el.childElementCount === 0 && LABELS.has(el.textContent.trim()));
          const hidden = new WeakSet();
          let timer = 0;
          const sweep = () => {
            timer = 0;
            let n = 0;
            for (const row of document.querySelectorAll('[role="main"] tr')) {
              // Gmail reuses rows when it changes tabs: check every row each time.
              if (sponsored(row)) {
                row.style.setProperty("display", "none", "important");
                hidden.add(row);
                n++;
              } else if (hidden.has(row)) {
                row.style.removeProperty("display");
                hidden.delete(row);
              }
            }
            report(n);
          };
          new MutationObserver(() => (timer ||= setTimeout(sweep, 250)))
            .observe(document.body, { childList: true, subtree: true });
          sweep();
        `,
      },
    ],
  },
};
