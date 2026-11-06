/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const phases = new Set(["idle", "available", "preparing", "ready", "waiting", "installing", "error"]);
const working = new Set(["preparing", "waiting", "installing"]);
export function updateStatus(record = {}) {
  return { phase: phases.has(record.phase) ? record.phase : "idle",
    automatic: record.automatic === true, tag: record.tag ?? null,
    restartToken: record.phase === "waiting" ? record.restartToken : null,
    error: record.phase === "error" ? record.error : null };
}

// One controller per browser process. The adapter supplies privileged IO;
// neither web content nor individual windows can choose executable paths.
export class ForkUpdateController {
  constructor(adapter) {
    this.adapter = adapter;
    this.state = updateStatus();
    this.listeners = new Set();
    this.started = false;
    this.operation = null;
    this.restarting = false;
  }

  publish(value) {
    this.state = { ...updateStatus(value), restarting: this.restarting };
    for (const listener of this.listeners) listener(this.state);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    if (!this.started) {
      this.started = true;
      this.initialize();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.adapter.clearTimeout(this.timer);
        this.stopWatchingQuit?.();
        this.stopWatchingQuit = null;
        this.started = false;
      }
    };
  }

  async initialize() {
    try {
      this.enabled = await this.adapter.initialize();
      if (this.enabled) {
        await this.refresh();
        if (this.started && !this.stopWatchingQuit)
          this.stopWatchingQuit = this.adapter.watchQuit?.(() => this.onQuit());
        this.schedule(30_000);
      }
    } catch (error) { this.adapter.report(error); }
  }

  schedule(delay = working.has(this.state.phase) ? 1000 : 60_000) {
    this.adapter.clearTimeout(this.timer);
    if (!this.started || !this.enabled) return;
    this.timer = this.adapter.setTimeout(async () => {
      try {
        const record = await this.refresh();
        const now = this.adapter.now();
        const recover = working.has(this.state.phase) &&
          now - (Date.parse(record.updatedAt) || 0) > 120_000 &&
          now - (this.recoveredAt || 0) > 60_000;
        if (!this.operation && !this.restarting && (recover ||
            (!working.has(this.state.phase) && now - (Date.parse(record.checkedAt) || 0) > 6 * 60 * 60 * 1000))) {
          if (recover) this.recoveredAt = now;
          await this.command("check");
        }
      } catch (error) { this.adapter.report(error); }
      this.schedule();
    }, delay);
  }

  async refresh() {
    const record = await this.adapter.read();
    this.publish(record);
    return record;
  }

  async command(action, extra = []) {
    if (!this.enabled) return this.state;
    if (this.operation) return this.operation;
    this.operation = (async () => {
      try {
        const result = await this.adapter.command(action, extra);
        this.publish(result);
        return result;
      } catch (error) {
        this.adapter.report(error);
        // A failed background check shouldn't create a spurious update banner.
        if (action !== "check" || this.state.phase !== "idle")
          this.publish({ ...this.state, phase: "error", error: String(error) });
        return this.state;
      } finally { this.operation = null; }
    })();
    this.schedule(250);
    return this.operation;
  }

  automatic(enabled) {
    return this.command("automatic", ["--enabled", String(enabled)]);
  }

  onQuit() {
    if (!this.enabled || this.restarting || this.operation ||
        !this.state.automatic || this.state.phase !== "ready") return;
    // This notification runs only after quit has been accepted. Apply the
    // prepared update after process exit, and respect the user's choice to quit.
    try { this.adapter.detach(this.adapter.token(), false); }
    catch (error) { this.adapter.report(error); }
  }

  async restart() {
    if (!this.enabled || this.restarting || this.operation) return;
    this.restarting = true;
    this.publish(this.state);
    let token;
    try {
      if (this.state.phase !== "ready") await this.command("prepare");
      if (this.state.phase !== "ready") return;
      token = this.adapter.token();
      this.adapter.detach(token);
      // Never close the user's browser until the external installer has
      // verified the candidate and acknowledged this exact restart request.
      let acknowledged = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        await this.adapter.delay(100);
        await this.refresh();
        if (this.state.phase === "waiting" && this.state.restartToken === token) {
          acknowledged = true;
          break;
        }
        if (this.state.phase === "error") break;
      }
      if (!acknowledged) throw new Error("The update could not start. Please try again.");
      if (!this.adapter.quit()) {
        await this.adapter.cancel(token);
        this.publish({ ...this.state, phase: "ready", restartToken: null });
      }
    } catch (error) {
      if (token) await this.adapter.cancel(token).catch(this.adapter.report);
      this.publish({ ...this.state, phase: "error", error: String(error) });
    } finally {
      this.restarting = false;
      this.publish(this.state);
    }
  }
}
