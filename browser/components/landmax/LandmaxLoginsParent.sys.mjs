/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Logins (landmax-library: docs/site-apps-plan.md › Accounts). A login is a named account at one vendor in its own
// container; the profile's landmax-logins.json says which account each container is for. On that vendor's sign-in
// page, inside that container, the child asks here for the account's email so the person only has to press Next.

import { setTimeout } from "resource://gre/modules/Timer.sys.mjs";

const SIGN_IN_HOSTS = { "accounts.google.com": "google" };
// A vendor's advert page that a signed-out app lands on instead of signing in (Gmail does this at random), and the
// vendor's sign-in page to send a login there instead.
const ADVERT_PAGES = {
  "workspace.google.com": {
    vendor: "google",
    path: /\/gmail\/?$/,
    signIn: "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fmail.google.com%2Fmail%2F&service=mail&flowName=GlifWebSignIn&flowEntry=ServiceLogin",
  },
};

let registry = null;
async function loginFor(userContextId, vendor) {
  if (!registry) {
    const file = PathUtils.join(PathUtils.profileDir, "landmax-logins.json");
    registry = (await IOUtils.exists(file)) ? await IOUtils.readJSON(file) : { logins: [] };
    // Read again on the next sign-in page: `landmax-reader-logins setup` may have added a login.
    setTimeout(() => (registry = null), 60000);
  }
  return registry.logins.find(l => l.userContextId === userContextId && l.vendor === vendor) ?? null;
}

export class LandmaxLoginsParent extends JSWindowActorParent {
  async receiveMessage(message) {
    if (message.name === "LandmaxLogins:Advert") {
      const page = ADVERT_PAGES[this.manager.documentPrincipal?.host];
      if (!page || this.browsingContext.parent || !page.path.test((this.manager.documentURI?.pathQueryRef ?? "").split("?")[0])) {
        return null;
      }
      const login = await loginFor(this.browsingContext.originAttributes.userContextId, page.vendor);
      return login ? page.signIn : null;
    }
    if (message.name !== "LandmaxLogins:Email") {
      return null;
    }
    // Only the vendor's own sign-in page, in the top frame, gets the email, and only that container's.
    const host = this.manager.documentPrincipal?.host;
    const vendor = SIGN_IN_HOSTS[host];
    if (!vendor || this.browsingContext.parent) {
      return null;
    }
    const login = await loginFor(this.browsingContext.originAttributes.userContextId, vendor);
    return login?.expect ?? null;
  }
}
