/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The parent half of LandmaxRecipeChild: hands out the injections while Reader is still starting (after that they
// reach every content process through sharedData).

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  LandmaxRecipes: "moz-src:///browser/components/landmax/LandmaxRecipes.sys.mjs",
});

export class LandmaxRecipeParent extends JSWindowActorParent {
  async receiveMessage(message) {
    if (message.name === "LandmaxRecipe:Get") {
      return (await lazy.LandmaxRecipes.ready()).injections;
    }
    return null;
  }
}
