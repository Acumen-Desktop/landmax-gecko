/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Fills the login's email on the vendor's sign-in page (see LandmaxLoginsParent). Never submits, never touches a
// field the person has typed in, never fills a password.

const FIELD = 'input[type="email"], input#identifierId, input[name="identifier"]';
const WAIT_MS = 10000;

export class LandmaxLoginsChild extends JSWindowActorChild {
  async handleEvent(event) {
    if (event.type !== "DOMContentLoaded" || this.filled) {
      return;
    }
    if (this.document.location.host !== "accounts.google.com") {
      // A login that landed on the vendor's advert page goes to its sign-in page instead.
      const signIn = await this.sendQuery("LandmaxLogins:Advert");
      if (signIn) {
        this.contentWindow.location.replace(signIn);
      }
      return;
    }
    const email = await this.sendQuery("LandmaxLogins:Email");
    if (!email) {
      return;
    }
    const field = await this.waitForField();
    if (!field || field.value) {
      return;
    }
    this.filled = true;
    field.setUserInput(email);
  }

  waitForField() {
    const doc = this.document;
    const found = doc.querySelector(FIELD);
    if (found) {
      return Promise.resolve(found);
    }
    return new Promise(resolve => {
      const win = this.contentWindow;
      const observer = new win.MutationObserver(() => {
        const field = doc.querySelector(FIELD);
        if (field) {
          observer.disconnect();
          resolve(field);
        }
      });
      observer.observe(doc.documentElement, { childList: true, subtree: true });
      win.setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, WAIT_MS);
    });
  }
}
