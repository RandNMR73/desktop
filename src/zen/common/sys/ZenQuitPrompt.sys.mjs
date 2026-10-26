/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  PromptUtils: "resource://gre/modules/PromptUtils.sys.mjs",
});

ChromeUtils.defineLazyGetter(
  lazy,
  "l10n",
  () =>
    new Localization(["branding/brand.ftl", "browser/zen-general.ftl"], true),
);

export const ZenQuitPrompt = {
  _open: false,

  // The quit-request observer is synchronous. Use the same modal event-loop
  // pattern as Gecko's Prompter, retaining gDialogBox's queue and focus trap.
  // Reentrant requests cancel instead of replacing the confirmation in flight.
  confirm(win) {
    if (this._open || !win?.gDialogBox || win.closed) {
      return 1;
    }
    this._open = true;
    try {
      const [title, quit, cancel, neverAsk] = lazy.l10n.formatValuesSync([
        "zen-quit-title",
        "zen-quit-accept",
        "zen-quit-cancel",
        "zen-quit-never-ask",
      ]);
      if (
        ![title, quit, cancel, neverAsk].every(
          (value) => typeof value === "string" && value.length,
        )
      ) {
        throw new Error("Missing quit confirmation strings");
      }
      const args = {
        promptType: "confirmEx",
        async: false,
        modalType: Ci.nsIPrompt.MODAL_TYPE_WINDOW,
        title,
        button0Label: quit,
        button1Label: cancel,
        button2Label: neverAsk,
        defaultButtonNum: 0,
        buttonNumClicked: 1,
      };
      const bag = lazy.PromptUtils.objectToPropBag(args);
      let closed = false;
      let failed = false;
      win.gDialogBox.replaceDialogIfOpen();
      win.gDialogBox
        .open("chrome://browser/content/zen-dialogs/quit.html", bag)
        .then(() => {
          lazy.PromptUtils.propBagToObject(bag, args);
        })
        .catch((error) => {
          failed = true;
          console.error("Could not open quit confirmation", error);
        })
        .finally(() => {
          closed = true;
        });
      Services.tm.spinEventLoopUntilOrQuit(
        "ZenQuitPrompt.confirm",
        () => closed,
      );
      return !failed && closed && [0, 2].includes(args.buttonNumClicked)
        ? args.buttonNumClicked
        : 1;
    } catch (error) {
      console.error("Could not show quit confirmation", error);
      return 1;
    } finally {
      this._open = false;
    }
  },
};
