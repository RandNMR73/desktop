/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const args = window.arguments[0].QueryInterface(Ci.nsIWritablePropertyBag);
const input = document.getElementById("name");
document.title = args.getProperty("title");
// The HTML document.title getter collapses whitespace; visible names must not.
document.getElementById("title").textContent = args.getProperty("title");
input.value = args.getProperty("value");
input.placeholder = args.getProperty("placeholder");
document.querySelector("#cancel span").textContent =
  args.getProperty("button1Label");
document.querySelector("#accept span").textContent =
  args.getProperty("button0Label");

// Keep Gecko's modal queue, focus trap and shortcut suppression. Restore the
// reused outer frame when this document unloads so ordinary prompts are intact.
const box = window.frameElement?.closest(".dialogBox");
box?.classList.add("zen-favorite-rename-dialog");
window.addEventListener(
  "unload",
  () => box?.classList.remove("zen-favorite-rename-dialog"),
  { once: true },
);

const close = (accepted) => {
  args.setProperty("ok", accepted);
  if (accepted) args.setProperty("value", input.value);
  window.close();
};
document.getElementById("cancel").addEventListener("click", () => close(false));
document.getElementById("accept").addEventListener("click", () => close(true));
document.subDialogSetDefaultFocus = () => {
  input.focus();
  input.select();
};
document.addEventListener("keydown", (event) => {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey)
    return;
  if (event.key === "Escape") {
    event.preventDefault();
    close(false);
  } else if (event.key === "Enter" && event.target.localName !== "button") {
    event.preventDefault();
    close(true);
  }
});
