/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { commandQueryRules } from "./ZenCommandMatching.sys.mjs";

const RETENTION_MS = 90 * 86400 * 1000;
const key = value => value.normalize("NFC");
const profileKey = value => value == null ? "Default" : typeof value === "string" ? key(value) : null;

function copyIdentity(value) {
  if (!value || !Number.isInteger(value.kind) || value.kind < 0 || value.kind > 8 ||
      typeof value.value !== "string" || (value.kind === 2 && typeof value.secondary !== "string")) return null;
  return { kind: value.kind, value: value.value,
    ...(value.kind === 2 ? { secondary: value.secondary } : {}) };
}

async function createStorage() {
  const { JSONFile } = ChromeUtils.importESModule("resource://gre/modules/JSONFile.sys.mjs");
  const file = new JSONFile({ path: PathUtils.join(PathUtils.profileDir, "zen-command-selections.json") });
  await file.load();
  return {
    data: file.data,
    save(data) { file.data = data; file.saveSoon(); },
  };
}

/** Profile-scoped remembered choices. This store is lazy and shared across
 * windows; importing it does not read or write browsing data. Callers supply
 * explicit privacy/profile context and an already derived selection identity.
 * Live selection capture remains gated with the ranking integration. */
export class CommandSelectionHistory {
  #profiles = new Map();
  #loading;
  #storage;
  #createStorage;
  #queryRules;
  #now;

  constructor({ storage = createStorage, queryRules = commandQueryRules, now = Date.now } = {}) {
    this.#createStorage = storage;
    this.#queryRules = queryRules;
    this.#now = now;
  }

  #ready() {
    return this.#loading ??= (async () => {
      const storage = await this.#createStorage();
      const data = storage.data;
      // JSONFile initializes a missing file to {}. An unknown schema must not
      // be overwritten with an empty store by an older browser version.
      if (data != null && (typeof data !== "object" || Array.isArray(data) ||
          (Object.keys(data).length && (data.version !== 1 || !Array.isArray(data.profiles))))) return false;
      for (const profile of data?.profiles ?? []) {
        if (typeof profile?.id !== "string" || !Array.isArray(profile.entries)) continue;
        const entries = this.#profiles.get(key(profile.id)) ?? new Map();
        for (const entry of profile.entries) {
          const identity = copyIdentity(entry?.identity);
          if (typeof entry?.query !== "string" || !identity || !Number.isFinite(entry.selectedAt)) continue;
          entries.set(key(entry.query), { query: entry.query, identity, selectedAt: entry.selectedAt });
        }
        this.#profiles.set(key(profile.id), entries);
      }
      this.#storage = storage;
      return true;
    })().catch(() => false);
  }

  async record({ query, identity, profileID, isPrivate = false, selectedAt = this.#now() }) {
    const profile = profileKey(profileID);
    identity = copyIdentity(identity);
    if (isPrivate || profile === null || typeof query !== "string" || !identity ||
        !Number.isFinite(selectedAt)) return false;
    // The URL parser's success is a different predicate. Older native
    // runtimes cannot safely decide whether this query should be learned.
    if (this.#queryRules(query)?.isURLLike !== false || !await this.#ready()) return false;
    const now = this.#now();
    if (!Number.isFinite(now)) return false;
    const entries = this.#profiles.get(profile) ?? new Map();
    entries.set(key(query), { query, identity, selectedAt });
    this.#profiles.set(profile, entries);
    // Arc prunes selected choices by date in every profile after recording.
    // Its 100-item cap belongs to recently switched tabs, not this dictionary.
    // Future timestamps survive pruning; the ranking pass separately applies
    // its absolute, inclusive 24-hour promotion window.
    for (const [id, choices] of this.#profiles) {
      for (const [queryKey, choice] of choices) {
        if (choice.selectedAt < now - RETENTION_MS) choices.delete(queryKey);
      }
      if (!choices.size) this.#profiles.delete(id);
    }
    this.#save();
    return true;
  }

  async selectedResult(query, { profileID, isPrivate = false, now = this.#now() } = {}) {
    const profile = profileKey(profileID);
    if (isPrivate || profile === null || typeof query !== "string" ||
        !Number.isFinite(now) || !await this.#ready()) return null;
    const entry = this.#profiles.get(profile)?.get(key(query));
    return entry ? { query: entry.query, identity: copyIdentity(entry.identity),
      ageSeconds: (now - entry.selectedAt) / 1000 } : null;
  }

  async clear({ profileID, allProfiles = false } = {}) {
    const profile = profileKey(profileID);
    if (profile === null || !await this.#ready()) return false;
    if (allProfiles) this.#profiles.clear();
    else this.#profiles.delete(profile);
    this.#save();
    return true;
  }

  #save() {
    this.#storage.save({ version: 1, profiles: [...this.#profiles].map(([id, entries]) => ({
      id, entries: [...entries.values()].map(entry => ({ ...entry, identity: copyIdentity(entry.identity) })),
    })) });
  }
}

export const ZenCommandSelectionHistory = new CommandSelectionHistory();
