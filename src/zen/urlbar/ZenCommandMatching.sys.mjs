/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

let library;
let backend;

function native() {
  if (backend !== undefined) return backend;
  backend = null;
  if (Services.appinfo.OS !== "Darwin") return null;
  try {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const executable = Services.dirsvc.get("XREExeF", Ci.nsIFile);
    library = ctypes.open(PathUtils.join(executable.parent.path, "libzen-native-theme.dylib"));
    const declare = (name, result, ...args) => library.declare(name, ctypes.default_abi, result, ...args);
    const version = declare("zen_command_matching_version", ctypes.int32_t)();
    if (![1, 2, 3, 4, 5, 6, 7, 8].includes(version)) return null;
    const match = declare("zen_command_match_features", ctypes.char.ptr, ctypes.uint8_t.ptr, ctypes.uint32_t);
    const signals = version >= 2
      ? declare("zen_command_match_signals", ctypes.char.ptr, ctypes.uint8_t.ptr, ctypes.uint32_t)
      : null;
    const queryRules = version >= 3
      ? declare("zen_command_query_rules", ctypes.char.ptr, ctypes.uint8_t.ptr, ctypes.uint32_t)
      : null;
    const urlKeys = version >= 7
      ? declare("zen_command_url_keys", ctypes.char.ptr, ctypes.uint8_t.ptr, ctypes.uint32_t)
      : null;
    const release = declare("zen_command_matching_free", ctypes.void_t, ctypes.char.ptr);
    const call = (method, request) => {
      if (!method) return null;
      const bytes = new TextEncoder().encode(JSON.stringify(request));
      if (bytes.length > 4_194_304) return null;
      const input = ctypes.uint8_t.array(bytes.length)(bytes);
      const result = method(input, bytes.length);
      if (result.isNull()) return null;
      try {
        return JSON.parse(result.readString());
      } finally {
        release(result);
      }
    };
    backend = { version, features: request => call(match, request), signals: request => call(signals, request),
      queryRules: request => call(queryRules, request), urlKeys: request => call(urlKeys, request) };
  } catch { /* Older libraries cannot supply the reference's text features. */ }
  return backend;
}

/** The scoped-search adapter needs the complete query and matching contract. */
export function commandMatchingAvailable() {
  return (native()?.version ?? 0) >= 8;
}

/** Native URL identities and duplicate keys, in input order. Activation URLs
 * remain untouched. An unparseable URL has no isRootURL measurement.
 * ABI 7 is required; older runtimes must not substitute display-only keys. */
export function prepareCommandURLs(urls) {
  const api = native();
  if (!api || api.version < 7 || !Array.isArray(urls) || urls.length > 4096 ||
      !urls.every(url => typeof url === "string")) return null;
  try {
    const results = api.urlKeys({ urls });
    return Array.isArray(results) && results.length === urls.length && results.every(result =>
      typeof result?.normalizedURL === "string" && typeof result.deduplicationURL === "string" &&
      (result.isRootURL === undefined || typeof result.isRootURL === "boolean")) ? results : null;
  } catch {
    return null;
  }
}

/** Batch numeric text features in provider order, or null if unavailable.
 * No candidate identity, browser state, or activation is passed to native code.
 * See tools/command-ranking/README.md for provider coverage. */
export function matchCommandCandidates(query, candidates) {
  const api = native();
  if (!api) return null;
  try {
    const results = api.features({ query, candidates: candidates.map(({ url, title, hotWords }) => ({ url, title, hotWords })) });
    return Array.isArray(results) && results.length === candidates.length ? results : null;
  } catch {
    return null;
  }
}

/** Text features, boosts, and completion text in provider order.
 * General signals require ABI 2; action signals/context require ABI 4.
 * ABI 6 adds the native action-prefix predicate for phrase-search ordering.
 * New bundles also return selectionIdentity for the four Chromium search
 * cases. Its presence is the capability check; older ABI-compatible bundles
 * omit it. Profile scope, timestamps, history and activation stay with the caller.
 * Action metadata contains a kind, optional menu ID, and retained record count. */
export function matchCommandCandidateSignals(query, candidates, { menuItemIDsToBoost } = {}) {
  const api = native();
  if (!api) return null;
  try {
    if (api.version < 4 && (menuItemIDsToBoost !== undefined ||
      candidates.some(candidate => candidate.archetype === "typeTravel"))) return null;
    const results = api.signals({ query, menuItemIDsToBoost, candidates: candidates.map(candidate => ({
      archetype: candidate.archetype,
      url: candidate.url,
      title: candidate.title,
      customTitle: candidate.customTitle,
      hotWords: candidate.hotWords,
      completionText: candidate.completionText,
      savedContext: candidate.savedContext,
      lastNavigated: candidate.features?.lastNavigated,
      fuzzySearchConfidence: candidate.features?.fuzzySearchConfidence,
      chromiumRank: candidate.features?.chromiumRank,
      action: candidate.archetype === "typeTravel" && candidate.action ? {
        kind: candidate.action.kind,
        menuItemIdentifier: candidate.action.menuItemIdentifier,
        recordedExecutionCount: candidate.action.recordedExecutionCount,
      } : undefined,
    })) });
    return Array.isArray(results) && results.length === candidates.length &&
      (api.version < 6 || results.every(result => typeof result?.phraseSearchActionPrefix === "boolean"))
      ? results : null;
  } catch {
    return null;
  }
}

/** Query-specific maximum indices, using Swift Characters and native regex.
 * ABI 5 also returns URL interpretation/navigation text and derives the
 * Backspace policy. Explicit interpretation remains available from ABI 3.
 * ABI 6 adds isPhraseSearch using the native literal-space and URL checks.
 * ABI 8 adds isURLLike, the regex gate used by remembered-choice recording.
 * This does not enable ranking in the live providers. */
export function commandQueryRules(query, { isPrivate = false, urlInterpretation, didBackspace } = {}) {
  const api = native();
  if (!api) return null;
  try {
    if (didBackspace !== undefined && api.version < 5) return null;
    const result = api.queryRules({ query, isPrivate, urlInterpretation, didBackspace });
    if (api.version >= 8 && typeof result?.isURLLike !== "boolean") return null;
    if (api.version >= 6 && typeof result?.isPhraseSearch !== "boolean") return null;
    if (api.version >= 5 && !(result?.urlInterpretation === "url"
      ? typeof result.navigationURL === "string" && result.navigationURL.length > 0
      : result?.urlInterpretation === "search" && result.navigationURL === undefined)) return null;
    const ranks = result?.preferredMaxRanks;
    return ranks && typeof ranks === "object" && !Array.isArray(ranks) &&
      Object.values(ranks).every(value => Number.isInteger(value) && value >= 0) &&
      Number.isInteger(result.characterCount) && result.characterCount >= 0 &&
      typeof result.specialSearchSyntax === "boolean" ? result : null;
  } catch {
    return null;
  }
}
