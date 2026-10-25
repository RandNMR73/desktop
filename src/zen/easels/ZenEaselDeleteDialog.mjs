/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const args = window.arguments[0].QueryInterface(Ci.nsIWritablePropertyBag);
const title = args.getProperty("title");
document.title = title;
document.getElementById("title").textContent = title;
document.getElementById("message").textContent = args.getProperty("text");
document.querySelector("#cancel span").textContent =
  args.getProperty("button1Label");
document.querySelector("#delete span").textContent =
  args.getProperty("button0Label");

// Retain Gecko's window modality, shortcut suppression, queue and focus trap.
// Only this dialog's frame receives the Arc-style surface treatment.
const box = window.frameElement?.closest(".dialogBox");
box?.classList.add("zen-easel-confirmation");
window.addEventListener(
  "unload",
  () => box?.classList.remove("zen-easel-confirmation"),
  { once: true },
);

const close = (accepted) => {
  args.setProperty("buttonNumClicked", accepted ? 0 : 1);
  window.close();
};
document.getElementById("cancel").addEventListener("click", () => close(false));
document.getElementById("delete").addEventListener("click", () => close(true));
document.subDialogSetDefaultFocus = () =>
  document.getElementById("confirmation").focus();
document.addEventListener("keydown", (event) => {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    close(false);
  } else if (event.key === "Enter" && event.target.localName !== "button") {
    event.preventDefault();
    close(true);
  }
});
