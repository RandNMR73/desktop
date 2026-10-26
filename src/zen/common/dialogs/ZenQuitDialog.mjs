/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const args = window.arguments[0].QueryInterface(Ci.nsIWritablePropertyBag);
document.title = args.getProperty("title");
document.getElementById("title").textContent = document.title;
for (const [id, property] of [
  ["quit", "button0Label"],
  ["cancel", "button1Label"],
  ["never-ask", "button2Label"],
]) {
  document.querySelector(`#${id} span`).textContent =
    args.getProperty(property);
}

const box = window.frameElement?.closest(".dialogBox");
box?.classList.add("zen-quit-confirmation");
window.addEventListener(
  "unload",
  () => box?.classList.remove("zen-quit-confirmation"),
  { once: true },
);

let finished = false;
function close(result) {
  if (finished) return;
  finished = true;
  args.setProperty("buttonNumClicked", result);
  window.close();
}
document.getElementById("quit").addEventListener("click", () => close(0));
document.getElementById("cancel").addEventListener("click", () => close(1));
document.getElementById("never-ask").addEventListener("click", () => close(2));
document.subDialogSetDefaultFocus = () => document.body.focus();
document.addEventListener("keydown", (event) => {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey)
    return;
  if (event.key === "Escape") {
    event.preventDefault();
    close(1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    close(0);
  }
});
