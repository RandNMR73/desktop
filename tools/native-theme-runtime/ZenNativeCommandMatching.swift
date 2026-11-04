/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import Foundation

private let commandWordBoundaries: Set<Character> = [" ", "/", "-", "_"]

private struct CommandNeedle {
    let characters: [Character]
    let failure: [Int]

    init(_ value: Substring) {
        let chars = Array(value)
        var table = Array(repeating: 0, count: chars.count + 1)
        table[0] = -1
        var candidate = 0
        if chars.count > 1 {
            for position in 1..<chars.count {
                if chars[position] == chars[candidate] {
                    table[position] = table[candidate]
                } else {
                    table[position] = candidate
                    while candidate >= 0 && chars[position] != chars[candidate] {
                        candidate = table[candidate]
                    }
                }
                candidate += 1
            }
        }
        table[chars.count] = candidate
        characters = chars
        failure = table
    }

    func score(_ text: [Character]) -> Double {
        var index = 0, matched = 0, run = 0, longest = 0, longestWord = 0
        var wordStart = true
        while index < text.count && matched < characters.count {
            if text[index] == characters[matched] {
                run += 1
                matched += 1
                longest = max(longest, run)
                if wordStart { longestWord = max(longestWord, run) }
                if matched == characters.count {
                    // Complete matches retain the run length across overlaps.
                    matched = failure[matched]
                }
                index += 1
            } else {
                matched = failure[matched]
                if matched < 0 { index += 1; matched += 1 }
                wordStart = commandWordBoundaries.contains(text[index - matched - 1])
                run = matched
            }
        }
        func squares(_ count: Int) -> Double {
            Double(count * (count + 1) * (2 * count + 1)) / 6
        }
        return squares(longest) + squares(longestWord)
    }
}

struct CommandTextMatch {
    let score: Double
    let position: Int?
    let percentage: Double
}

struct CommandSearchableText: Decodable {
    let url: String?
    let title: String?
    let hotWords: [String]?
}

final class CommandTextMatcher {
    private let needles: [CommandNeedle]
    private let tokens: [String]
    private var cache: [String: CommandTextMatch] = [:]

    init(query: String) {
        let query = String(query.prefix(512))
        needles = query.lowercased().split(whereSeparator: commandWordBoundaries.contains)
            .map(CommandNeedle.init)
        tokens = query.split(separator: " ").map(String.init)
    }

    func match(_ value: String) -> CommandTextMatch {
        let text = String(value.prefix(512))
        if let cached = cache[text] { return cached }
        let characters = Array(text.lowercased())
        let score = needles.reduce(0) { $0 + $1.score(characters) }
        var covered = Array(repeating: false, count: text.count)
        for token in tokens {
            var start = text.startIndex
            while start < text.endIndex,
                  let found = text.range(of: token, options: .caseInsensitive,
                                         range: start..<text.endIndex, locale: nil) {
                let composed = text.rangeOfComposedCharacterSequences(for: found)
                // Preserve the reference's Swift/Foundation conversion;
                // NSString and CoreFoundation searches differ on Unicode text.
                if !composed.isEmpty,
                   let range = Range(NSRange(composed, in: text), in: text) {
                    let first = text.distance(from: text.startIndex, to: range.lowerBound)
                    let last = first + text.distance(from: range.lowerBound, to: range.upperBound)
                    for index in first..<last { covered[index] = true }
                }
                start = composed.upperBound
            }
        }
        let result = CommandTextMatch(score: score, position: covered.firstIndex(of: true),
            percentage: covered.isEmpty ? 0 : Double(covered.filter { $0 }.count) / Double(covered.count))
        cache[text] = result
        return result
    }

    func features(_ input: CommandSearchableText) -> [String: Double] {
        var result: [String: Double] = [:]
        func add(_ name: String, _ value: CommandTextMatch) {
            result[name + "MatchScore"] = value.score
            result[name + "MatchPercentage"] = value.percentage
            if let position = value.position { result[name + "MatchPosition"] = Double(position) }
        }
        if let url = input.url { add("url", match(url)) }
        if let title = input.title { add("title", match(title)) }
        if let words = input.hotWords {
            var score = 0.0, percentage = 0.0
            var position: Int?
            for word in words {
                let current = match(word)
                if current.score > score || (current.score == score &&
                    (current.percentage > percentage || (current.percentage == percentage &&
                     (current.position ?? Int.max) < (position ?? Int.max)))) {
                    score = current.score
                    percentage = max(percentage, current.percentage)
                    if let currentPosition = current.position { position = currentPosition }
                }
            }
            add("hotWords", CommandTextMatch(score: score, position: position, percentage: percentage))
        }
        return result
    }
}

private struct CommandMatchingRequest: Decodable {
    let query: String
    let candidates: [CommandSearchableText]
}

@_cdecl("zen_command_matching_version")
public func commandMatchingVersion() -> Int32 { 7 }

@_cdecl("zen_command_match_features")
public func commandMatchFeatures(_ bytes: UnsafePointer<UInt8>?, _ length: UInt32) -> UnsafeMutablePointer<CChar>? {
    guard let bytes, length > 0, length <= 4_194_304 else { return nil }
    return autoreleasepool {
        guard let request = try? JSONDecoder().decode(CommandMatchingRequest.self,
                  from: Data(bytes: bytes, count: Int(length))),
              request.candidates.count <= 4096,
              request.candidates.allSatisfy({ ($0.hotWords?.count ?? 0) <= 64 }) else { return nil }
        let matcher = CommandTextMatcher(query: request.query)
        guard let encoded = try? JSONSerialization.data(withJSONObject: request.candidates.map(matcher.features)),
              let json = String(data: encoded, encoding: .utf8) else { return nil }
        return json.withCString { strdup($0) }
    }
}

@_cdecl("zen_command_matching_free")
public func commandMatchingFree(_ pointer: UnsafeMutablePointer<CChar>?) { free(pointer) }

// Boost comparisons use the complete strings, unlike the 512-character text
// feature window. Keep Swift's canonical equality and prefix semantics here.
enum CommandResultArchetype: String, Decodable {
    case tab, document, easel, topDomains, navigateWhatYouTyped, typeTravel
    case searchWhatYouTyped, askGPTWhatYouTyped, instantLinks, askAssistant, assistantHistory
    case chromiumSearchWhatYouTyped, chromiumSearchSuggestion, chromiumSearchHistory
    case chromiumHistory, chromiumNavigateWhatYouTyped, chromiumNavigateSuggestion
    case chromiumSearchOtherEngine, chromiumSearchCalculatorAnswer, chromiumBookmark

    var searchOnly: Bool {
        switch self {
        case .searchWhatYouTyped, .askGPTWhatYouTyped, .instantLinks,
             .chromiumSearchWhatYouTyped, .chromiumSearchSuggestion, .chromiumSearchHistory,
             .chromiumSearchOtherEngine, .chromiumSearchCalculatorAnswer: return true
        default: return false
        }
    }

    var savedItem: Bool { self == .tab || self == .document || self == .easel }

    var chromiumSearch: Bool {
        switch self {
        case .chromiumSearchWhatYouTyped, .chromiumSearchSuggestion, .chromiumSearchHistory,
             .chromiumSearchOtherEngine, .chromiumSearchCalculatorAnswer: return true
        default: return false
        }
    }
}

private enum CommandSavedContext: String, Decodable { case global, scoped }

private enum CommandActionKind: String, Decodable {
    case focusSpace, moveToSpace, moveToFolder, undoAction, redoAction, joinNextMeeting
    case menuItem, browserExtension, newWebDocument, openPreferencePane, openFolder
    case moveToTopApps, removeFromTopApps, moveToNewFolder, createNewFolder
    case collapseAllFolders, expandAllFolders, toggleSidebar, renameCurrentTab
    case duplicateCurrentTab, resetCurrentTab, replacePinnedTab, newVerticalSplitViewPane
    case convertToHorizontalSplitView, convertToVerticalSplitView
    case addRightSplit, addLeftSplit, addTopSplit, addBottomSplit, muteAllTabs, unmuteAllTabs
    case newArcNote, openPasswordManager, openSearchSettings, openAirTrafficControl
}

private struct CommandActionSignals: Decodable {
    let kind: CommandActionKind
    let menuItemIdentifier: String?
    // Count of the action's retained execution records, not its lifetime
    // frequency. The provider owns the history and its pruning policy.
    let recordedExecutionCount: UInt?
}

private struct CommandSignalCandidate: Decodable {
    let archetype: CommandResultArchetype
    let url: String?
    let title: String?
    let customTitle: String?
    let hotWords: [String]?
    // Search/provider completions are supplied explicitly. URL-backed kinds
    // and documents derive theirs below; display labels are not substitutes.
    let completionText: String?
    let savedContext: CommandSavedContext?
    let lastNavigated: Double?
    let fuzzySearchConfidence: Double?
    let chromiumRank: Double?
    let action: CommandActionSignals?

    var text: CommandSearchableText {
        // Searchable URL properties use display normalization before the
        // 512-character feature limit; the URL used by bonuses stays intact.
        CommandSearchableText(url: url.map(commandComparableURL), title: title, hotWords: hotWords)
    }

    var completion: String? {
        switch archetype {
        case .tab, .topDomains, .navigateWhatYouTyped, .chromiumHistory,
             .chromiumNavigateSuggestion, .chromiumBookmark:
            return url.map(commandComparableURL)
        case .document, .easel: return title?.lowercased()
        default: return completionText
        }
    }
}

// The reference's URL display normalization with option 1. This is a string
// transform, not URL canonicalization: strip one '?' suffix, one '/' suffix,
// one HTTP scheme, and one 'www.' prefix, in that order, then lowercase.
func commandComparableURL(_ value: String) -> String {
    var text = value[...]
    if text.hasSuffix("?") { text.removeLast() }
    if text.hasSuffix("/") { text.removeLast() }
    if text.hasPrefix("https://") { text = text.dropFirst(8) }
    else if text.hasPrefix("http://") { text = text.dropFirst(7) }
    if text.hasPrefix("www.") { text = text.dropFirst(4) }
    return String(text).lowercased()
}

// LazyURL's comparison preparation is distinct from display normalization.
// Keep these keys separate from the URL used to navigate or activate a tab.
// Foundation getters/setters matter here, including decoded query values and
// the distinction between an absent query and an empty one.
func commandPreparedURL(_ value: String) -> String {
    guard let original = URLComponents(string: value.lowercased()) else { return value }
    var parts = original
    if parts.scheme == nil && parts.host == nil, let text = parts.string,
       let absolute = URLComponents(string: "https://" + text) {
        parts = absolute
    }
    if parts.scheme == nil || parts.scheme == "http" { parts.scheme = "https" }
    if let host = parts.host, host.lowercased().hasPrefix("www.") {
        parts.host = host.split(separator: ".").dropFirst().joined(separator: ".")
    }
    if let fragment = parts.fragment, fragment.first == "!" {
        if fragment.last == "/" { parts.fragment = String(fragment.dropLast()) }
    } else {
        parts.fragment = nil
        // The reference reads the path from its original components here,
        // even if the missing-scheme helper constructed a new host above.
        if parts.path.last == "/" { parts.path = String(original.path.dropLast()) }
    }
    if let items = parts.queryItems {
        let retained = items.filter { !($0.value ?? "").isEmpty && !$0.name.hasPrefix("utm_") }
        if retained.isEmpty { parts.queryItems = nil }
        else if retained.count != items.count { parts.queryItems = retained }
    }
    guard let prepared = parts.string else { return value }
    // Canonically equal strings retain the original representation.
    return prepared == value ? value : prepared
}

private struct CommandURLRequest: Decodable { let urls: [String] }

/// Batch comparison keys without changing the supplied navigation URLs.
@_cdecl("zen_command_url_keys")
public func commandURLKeys(_ bytes: UnsafePointer<UInt8>?, _ length: UInt32) -> UnsafeMutablePointer<CChar>? {
    guard let bytes, length > 0, length <= 4_194_304 else { return nil }
    return autoreleasepool {
        guard let request = try? JSONDecoder().decode(CommandURLRequest.self,
                  from: Data(bytes: bytes, count: Int(length))), request.urls.count <= 4096 else { return nil }
        var cache: [Data: [String: Any]] = [:]
        let results = request.urls.map { url -> [String: Any] in
            // Swift String keys compare canonically. Use bytes so two input
            // spellings that Foundation percent-encodes differently cannot
            // accidentally share a serialized result.
            let key = Data(url.utf8)
            if let existing = cache[key] { return existing }
            let prepared = commandPreparedURL(url)
            var result: [String: Any] = ["normalizedURL": prepared,
                                       "deduplicationURL": commandComparableURL(prepared)]
            if let parts = URLComponents(string: url) {
                result["isRootURL"] = parts.query == nil &&
                    parts.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")).isEmpty
            }
            cache[key] = result
            return result
        }
        guard let encoded = try? JSONSerialization.data(withJSONObject: results),
              let json = String(data: encoded, encoding: .utf8) else { return nil }
        return json.withCString { strdup($0) }
    }
}

private struct CommandBoostMatcher {
    let query: String
    let comparableQuery: String
    let menuItemIDsToBoost: Set<String>?

    init(query: String, menuItemIDsToBoost: Set<String>? = nil) {
        self.query = query.lowercased()
        comparableQuery = commandComparableURL(self.query)
        self.menuItemIDsToBoost = menuItemIDsToBoost
    }

    func boosts(_ candidate: CommandSignalCandidate) -> [String] {
        var result: [String] = []
        var baseBoost = false
        let kind = candidate.archetype
        if !query.isEmpty, !query.hasPrefix("arc://"), !kind.searchOnly,
           let url = candidate.url {
            let comparableURL = commandComparableURL(url)
            let exact = comparableQuery == comparableURL || query == url
            // A query, including an explicitly empty '?', disqualifies a root
            // URL. Fragments do not. LazyURL's unavailable path defaults to '/'.
            let components = URLComponents(string: url)
            let root = components?.query == nil &&
                (components?.path ?? "/").trimmingCharacters(in: CharacterSet(charactersIn: "/")).isEmpty
            let prefix = query.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            let base = root && (url.hasPrefix(prefix) || comparableURL.hasPrefix(prefix))
            if exact && base && kind != .tab { result.append("exactBaseDomain") }
            if exact && (kind == .tab || !base) { result.append("exactURL") }
            baseBoost = base && (kind == .tab || !exact)
        }
        if !query.isEmpty {
            if candidate.hotWords?.contains(where: { $0.lowercased() == query }) == true {
                result.append("exactHotWord")
            }
            if baseBoost { result.append("baseDomain") }
            if candidate.completion?.hasPrefix(query) == true {
                result.append(kind.searchOnly ? "autocompleteSearchOnly" : "autocompleteDefault")
            }
            if kind.chromiumSearch, candidate.chromiumRank == 1, commandSpecialSearchSyntax(query) {
                result.append("chromiumSpecialSearchFunction")
            }
            let customTitle = kind == .tab ? candidate.customTitle :
                (kind == .document ? candidate.title : nil)
            if customTitle?.lowercased().hasPrefix(query) == true {
                result.append("customTitlePrefix")
            }
        }
        if kind.savedItem {
            if let age = candidate.lastNavigated, age < 3600 {
                result.append("veryRecentTabOrDocumentBoost")
            }
            if candidate.savedContext == .global { result.append("topApp") }
        }
        if kind == .typeTravel, let action = candidate.action {
            if let count = action.recordedExecutionCount, count > 1 {
                result.append("recentlyUseTypeTravel")
            }
            if query.count >= 3,
               candidate.hotWords?.contains(where: { $0.lowercased().hasPrefix(query) }) == true {
                result.append("typeTravelPrefixForLongQuery")
            }
            // Presence matters: an explicitly empty set still enables the
            // extension/rename promotions; an absent set disables all three.
            if let identifiers = menuItemIDsToBoost {
                let promotedMenu = action.kind == .menuItem &&
                    action.menuItemIdentifier.map(identifiers.contains) == true
                if promotedMenu || action.kind == .browserExtension || action.kind == .renameCurrentTab {
                    result.append("unboxingPromotedAction")
                }
            }
        }
        if let confidence = candidate.fuzzySearchConfidence, confidence > 0.8 {
            result.append("highFuzzySearchConfidence")
        }
        return result
    }
}

private struct CommandSignalRequest: Decodable {
    let query: String
    let candidates: [CommandSignalCandidate]
    let menuItemIDsToBoost: Set<String>?
}

/// Browser-result and action signals. Action kinds, retained usage counts, and
/// optional onboarding context must come from the provider, never title guesses.
@_cdecl("zen_command_match_signals")
public func commandMatchSignals(_ bytes: UnsafePointer<UInt8>?, _ length: UInt32) -> UnsafeMutablePointer<CChar>? {
    guard let bytes, length > 0, length <= 4_194_304 else { return nil }
    return autoreleasepool {
        guard let request = try? JSONDecoder().decode(CommandSignalRequest.self,
                  from: Data(bytes: bytes, count: Int(length))),
              request.candidates.count <= 4096,
              request.candidates.allSatisfy({ ($0.hotWords?.count ?? 0) <= 64 &&
                  ($0.archetype != .typeTravel || $0.action != nil) }) else { return nil }
        let matcher = CommandTextMatcher(query: request.query)
        let boosts = CommandBoostMatcher(query: request.query, menuItemIDsToBoost: request.menuItemIDsToBoost)
        let results: [[String: Any]] = request.candidates.map { candidate in
            var result: [String: Any] = ["features": matcher.features(candidate.text),
                                      "boosts": boosts.boosts(candidate),
                                      "phraseSearchActionPrefix": candidate.archetype == .typeTravel &&
                                          candidate.hotWords?.contains(where: {
                                              boosts.query.hasPrefix($0.lowercased())
                                          }) == true]
            if let completion = candidate.completion { result["completion"] = completion }
            return result
        }
        guard let encoded = try? JSONSerialization.data(withJSONObject: results),
              let json = String(data: encoded, encoding: .utf8) else { return nil }
        return json.withCString { strdup($0) }
    }
}

// The reference excludes known URL-scheme prefixes before accepting an
// operator:value expression. NSRegularExpression preserves its Unicode word
// class and end-anchor behavior. Callers decide whether to lowercase first:
// the boost does, while the maximum-rank policy uses the original query.
private let commandSpecialSearchPattern = try! NSRegularExpression(pattern:
    #"^(?!aaas?|about|acap|adiumxtra|af[ps]|aim|apt|arc|attachment|aw|beshare|bitcoin|bolo|callto|cap|chrome(?:-extension)?|cid|coap|com-eventbrite-attendee|content|crid|cvs|data|dav|dict|dlna-(?:playcontainer|playsingle)|dns|doi|dtn|dvb|ed2k|facetime|feed|file|finger|fish|ftp|geo|gg|git|gizmoproject|go|gopher|gtalk|h323|hcp|https?|iax|icap|icon|im|imap|info|ipn|ipp|irc[6s]?|iris(?:\.beep|\.lwz|\.xpc|\.xpcs)?|itms|jar|javascript|jms|keyparc|lastfm|ldaps?|localhost|magnet|mailto|maps|market|message|mid|mms|ms-help|msnim|msrps?|mtqp|mumble|mupdate|mvn|news|nfs|nih?|nntp|notes|oid|opaquelocktoken|palm|paparazzi|platform|pop|pres|proxy|psyc|query|res(?:ource)?|rmi|rsync|rtmp|rtsp|secondlife|service|session|sftp|sgn|shttp|sieve|sips?|skype|sm[bs]|snmp|soap\.beeps?|soldat|spotify|ssh|steam|svn|tag|teamspeak|tel(?:net)?|tftp|things|thismessage|tip|tn3270|tv|udp|unreal|urn|ut2004|vemmi|ventrilo|view-source|webcal|wss?|wtai|wyciwyg|xcon(?:-userid)?|xfire|xmlrpc\.beeps?|xmpp|xri|ymsgr|z39\.50[rs])\w+:\w+$"#)

private func commandSpecialSearchSyntax(_ query: String) -> Bool {
    commandSpecialSearchPattern.firstMatch(in: query, range: NSRange(query.startIndex..<query.endIndex, in: query)) != nil
}

// The reference uses Swift Regex.wholeMatch after lowercasing, not a dot test
// or Foundation's permissive relative-URL initializer. These are the six
// patterns assembled by its String+URL helpers, in their evaluation order.
private let commandURLPatterns: [Regex<AnyRegexOutput>] = [
    #"^(http(s)?:\/\/)?(localhost|127\.0\.0\.1)(:[0-9]{1,5})?((\?|\/|#).*)?"#,
    #"^(http(s)?:\/\/)?(([0-9]{1,3})\.){3}([0-9]{1,3})(:[0-9]{1,5})?((\?|\/|#).*)?"#,
    #"^(http(s)?:\/\/)?(([a-z0-9\-]+)\.)+[a-z]{2,}(:[0-9]{1,5})?((\?|\/|#).*)?"#,
    #"^(chrome:\/\/)(.*)"#,
    #"^(arc:\/\/)(.*)"#,
    #"^(file:\/\/)(.*)"#,
].map { try! Regex($0) }

private let commandURLSchemePatterns: [Regex<AnyRegexOutput>] = [
    #"^(http(s)?:\/\/)(.*)"#, #"^(chrome:\/\/)(.*)"#, #"^(file:\/\/)(.*)"#,
].map { try! Regex($0) }

private let commandURLAllowedCharacters: CharacterSet = {
    var allowed = CharacterSet(charactersIn: "#")
    for component in [CharacterSet.urlUserAllowed, .urlPasswordAllowed, .urlHostAllowed,
                      .urlPathAllowed, .urlQueryAllowed, .urlFragmentAllowed] {
        allowed.formUnion(component)
    }
    return allowed
}()

private func commandLooseURL(_ query: String) -> URL? {
    let lower = query.lowercased()
    guard commandURLPatterns.contains(where: { (try? $0.wholeMatch(in: lower)) != nil }) else { return nil }
    let hasScheme = commandURLSchemePatterns.contains(where: { (try? $0.wholeMatch(in: lower)) != nil })
    let candidate = hasScheme ? query : "http://" + query
    // Preserve the reference order: decode the entire string, then encode
    // with the union of URL component sets, then parse URLComponents.url.
    guard let decoded = candidate.removingPercentEncoding,
          let encoded = decoded.addingPercentEncoding(withAllowedCharacters: commandURLAllowedCharacters) else { return nil }
    return URLComponents(string: encoded)?.url
}

// An explicit interpretation remains supported for callers supplying a
// classification. Backspace requests derive theirs from the native parser.
private enum CommandURLInterpretation: String, Decodable { case url, search }
private struct CommandQueryRequest: Decodable {
    let query: String
    let isPrivate: Bool?
    let urlInterpretation: CommandURLInterpretation?
    let didBackspace: Bool?
}

private func commandQueryRules(_ request: CommandQueryRequest) -> [String: Any] {
    let query = request.query
    let special = commandSpecialSearchSyntax(query)
    let parsedURL = commandLooseURL(query)
    let parsedInterpretation: CommandURLInterpretation = parsedURL == nil ? .search : .url
    let requestedInterpretation = request.didBackspace == true ? parsedInterpretation : request.urlInterpretation
    var navigate: Int?, assistant: Int?, chromiumNavigate: Int?
    var search = 1
    if let interpretation = requestedInterpretation, !query.isEmpty {
        chromiumNavigate = 0
        if interpretation == .url {
            navigate = 0
            assistant = 2
        } else {
            search = 0
            assistant = 1
        }
    } else if request.isPrivate == true {
        navigate = 0
        assistant = 2
        chromiumNavigate = 0
    } else if special {
        search = 0
    } else if query.count >= 4 {
        assistant = 2
        chromiumNavigate = 0
    }
    // A final Swift Character equal to '?' promotes the assistant without
    // altering the independently chosen Chromium navigation limit.
    if query.last == "?" { assistant = 1 }
    var ranks = ["searchWhatYouTyped": search, "chromiumSearchWhatYouTyped": search]
    ranks["navigateWhatYouTyped"] = navigate
    ranks["askGPTWhatYouTyped"] = assistant
    ranks["chromiumNavigateWhatYouTyped"] = chromiumNavigate
    var result: [String: Any] = ["preferredMaxRanks": ranks, "characterCount": query.count,
        "specialSearchSyntax": special, "urlInterpretation": parsedInterpretation.rawValue,
        "isPhraseSearch": query.contains(" ") && parsedURL == nil]
    if let url = parsedURL { result["navigationURL"] = url.absoluteString }
    return result
}

@_cdecl("zen_command_query_rules")
public func commandQueryRulesJSON(_ bytes: UnsafePointer<UInt8>?, _ length: UInt32) -> UnsafeMutablePointer<CChar>? {
    guard let bytes, length > 0, length <= 4_194_304 else { return nil }
    return autoreleasepool {
        guard let request = try? JSONDecoder().decode(CommandQueryRequest.self, from: Data(bytes: bytes, count: Int(length))),
              let encoded = try? JSONSerialization.data(withJSONObject: commandQueryRules(request)),
              let json = String(data: encoded, encoding: .utf8) else { return nil }
        return json.withCString { strdup($0) }
    }
}
