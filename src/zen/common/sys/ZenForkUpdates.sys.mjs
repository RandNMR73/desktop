/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ForkUpdateController } from "resource:///modules/ZenForkUpdateController.sys.mjs";
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";

let configuration, app;
const args = (action, extra = []) => [configuration.helper, "banner", action,
  "--app", app, "--state-file", configuration.stateFile, ...extra];

async function command(action, extra) {
  const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
  const process = await Subprocess.call({ command: configuration.python, arguments: args(action, extra) });
  let output = "", chunk;
  while ((chunk = await process.stdout.readString())) output += chunk;
  await process.wait();
  return JSON.parse(output);
}

const adapter = {
  setTimeout, clearTimeout, now: () => Date.now(),
  delay: ms => new Promise(resolve => setTimeout(resolve, ms)),
  token: () => Services.uuid.generateUUID().toString().replace(/[{}-]/g, ""),
  report: error => console.error("Zen fork updates:", error),
  async initialize() {
    if (Services.appinfo.OS !== "Darwin") return false;
    const executable = Services.dirsvc.get("XREExeF", Ci.nsIFile);
    const bundle = executable.parent.parent.parent;
    bundle.normalize();
    app = bundle.path;
    const path = PathUtils.join(app, "Contents", "Resources", "astral-update.json");
    if (!(await IOUtils.exists(path))) return false;
    configuration = await IOUtils.readJSON(path);
    if (configuration.version !== 1 || configuration.repository !== "RandNMR73/desktop" ||
        !/^[0-9a-f]{40}$/.test(configuration.sourceRevision)) return false;
    for (const name of ["helper", "python", "stateFile"]) {
      if (typeof configuration[name] !== "string" || !PathUtils.isAbsolute(configuration[name])) return false;
    }
    return await IOUtils.exists(configuration.helper) && await IOUtils.exists(configuration.python);
  },
  async read() {
    if (!(await IOUtils.exists(configuration.stateFile))) return {};
    const state = await IOUtils.readJSON(configuration.stateFile);
    return state.bannerTargets?.[app] ?? {};
  },
  command,
  cancel: token => command("cancel", ["--token", token]),
  watchQuit(callback) {
    Services.obs.addObserver(callback, "quit-application-granted");
    return () => Services.obs.removeObserver(callback, "quit-application-granted");
  },
  detach(token, relaunch = true) {
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(configuration.python);
    const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    process.init(file);
    const arguments_ = args("apply", ["--token", token, ...(relaunch ? [] : ["--no-relaunch"])]);
    process.runwAsync(arguments_, arguments_.length);
  },
  quit() {
    const canceled = Cc["@mozilla.org/supports-PRBool;1"].createInstance(Ci.nsISupportsPRBool);
    Services.obs.notifyObservers(canceled, "quit-application-requested", "restart");
    if (canceled.data) return false;
    // The external worker relaunches the replacement after process exit.
    // eRestart here would race it by relaunching the old bundle.
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
    // attemptingQuit is set after every window accepts CanClose(). The
    // later shuttingDown phase can still be false while windows close.
    return Services.startup.attemptingQuit;
  },
};

export const ZenForkUpdates = new ForkUpdateController(adapter);
