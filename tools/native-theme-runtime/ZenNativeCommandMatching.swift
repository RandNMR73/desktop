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
public func commandMatchingVersion() -> Int32 { 2 }

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
    case tab, document, easel, topDomains, navigateWhatYouTyped
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
}

private enum CommandSavedContext: String, Decodable { case global, scoped }

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

    var text: CommandSearchableText {
        CommandSearchableText(url: url, title: title, hotWords: hotWords)
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

private struct CommandBoostMatcher {
    let query: String
    let comparableQuery: String

    init(query: String) {
        self.query = query.lowercased()
        comparableQuery = commandComparableURL(self.query)
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
        if let confidence = candidate.fuzzySearchConfidence, confidence > 0.8 {
            result.append("highFuzzySearchConfidence")
        }
        return result
    }
}

private struct CommandSignalRequest: Decodable {
    let query: String
    let candidates: [CommandSignalCandidate]
}

/// General browser-result signals. Action-specific boosts are intentionally
/// not inferred from titles or URLs; action integration needs its own metadata.
@_cdecl("zen_command_match_signals")
public func commandMatchSignals(_ bytes: UnsafePointer<UInt8>?, _ length: UInt32) -> UnsafeMutablePointer<CChar>? {
    guard let bytes, length > 0, length <= 4_194_304 else { return nil }
    return autoreleasepool {
        guard let request = try? JSONDecoder().decode(CommandSignalRequest.self,
                  from: Data(bytes: bytes, count: Int(length))),
              request.candidates.count <= 4096,
              request.candidates.allSatisfy({ ($0.hotWords?.count ?? 0) <= 64 }) else { return nil }
        let matcher = CommandTextMatcher(query: request.query)
        let boosts = CommandBoostMatcher(query: request.query)
        let results: [[String: Any]] = request.candidates.map { candidate in
            var result: [String: Any] = ["features": matcher.features(candidate.text),
                                      "boosts": boosts.boosts(candidate)]
            if let completion = candidate.completion { result["completion"] = completion }
            return result
        }
        guard let encoded = try? JSONSerialization.data(withJSONObject: results),
              let json = String(data: encoded, encoding: .utf8) else { return nil }
        return json.withCString { strdup($0) }
    }
}
