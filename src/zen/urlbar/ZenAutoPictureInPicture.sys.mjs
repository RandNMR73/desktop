// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

const PERMISSION = "zen-auto-picture-in-picture";
const ENABLED =
  "media.videocontrols.picture-in-picture.enable-when-switching-tabs.enabled";

/** Controls automatic detachment only; manual Picture-in-Picture is unaffected. */
export class AutoPictureInPicturePolicy {
  #services;
  #private = new Map();

  constructor(services) {
    this.#services = services;
    services.obs.addObserver(this, "last-pb-context-exited");
  }

  observe(subject, topic) {
    if (topic === "last-pb-context-exited") this.#private.clear();
  }

  #principal(browser) {
    try {
      const principal = browser?.contentPrincipal;
      if (
        !browser.isConnected ||
        !principal?.isContentPrincipal ||
        !["http", "https"].some((scheme) => principal.URI.schemeIs(scheme))
      ) {
        return null;
      }
      return principal;
    } catch {
      return null;
    }
  }

  #permission(principal) {
    // Gecko's permission manager normally strips userContextId from keys.
    // Encode it in this permission's type without changing global isolation.
    return `${PERMISSION}^${principal.originAttributes.userContextId || 0}`;
  }

  state(browser) {
    const principal = this.#principal(browser);
    const globallyEnabled =
      this.#services.prefs.getBoolPref(ENABLED, true) &&
      this.#services.prefs.getBoolPref(
        "media.videocontrols.picture-in-picture.enabled",
        true,
      );
    if (!principal)
      return { available: false, allowed: false, globallyEnabled };
    let allowed;
    if (principal.originAttributes.privateBrowsingId) {
      allowed = this.#private.get(principal.origin);
    }
    if (allowed === undefined) {
      // Private windows inherit regular choices but never write them. Container
      // attributes remain part of the principal when removing its private ID.
      const regular = principal.originAttributes.privateBrowsingId
        ? this.#services.scriptSecurityManager.createContentPrincipal(
            principal.URI,
            { ...principal.originAttributes, privateBrowsingId: 0 },
          )
        : principal;
      allowed =
        this.#services.perms.testExactPermissionFromPrincipal(
          regular,
          this.#permission(regular),
        ) !== this.#services.perms.DENY_ACTION;
    }
    return {
      available: true,
      allowed: globallyEnabled && allowed,
      globallyEnabled,
    };
  }

  allowed(browser) {
    return this.state(browser).allowed;
  }

  shouldDetach(browser) {
    const window = browser?.documentGlobal;
    return (
      !!window?.gBrowser &&
      !window.closed &&
      window.gBrowser.selectedBrowser !== browser &&
      !browser.audioMuted &&
      this.allowed(browser)
    );
  }

  setAllowed(browser, allowed) {
    const principal = this.#principal(browser);
    if (
      !principal ||
      typeof allowed !== "boolean" ||
      !this.state(browser).globallyEnabled
    ) {
      return false;
    }
    if (principal.originAttributes.privateBrowsingId) {
      this.#private.set(principal.origin, allowed);
    } else if (allowed) {
      this.#services.perms.removeFromPrincipal(
        principal,
        this.#permission(principal),
      );
    } else {
      this.#services.perms.addFromPrincipal(
        principal,
        this.#permission(principal),
        this.#services.perms.DENY_ACTION,
        this.#services.perms.EXPIRE_NEVER,
      );
    }
    return true;
  }
}

export const ZenAutoPictureInPicture = new AutoPictureInPicturePolicy(Services);
