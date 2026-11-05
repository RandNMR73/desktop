import Foundation

let input = FileHandle.standardInput.readDataToEndOfFile()
let pairs = try JSONSerialization.jsonObject(with: input) as! [[String: String]]
let result = pairs.map { pair -> [String: Any] in
    let query = pair["query"]!
    let suggestion = pair["suggestion"]!
    let prefix = suggestion.hasPrefix(query)
    return ["query": query, "suggestion": suggestion, "hasPrefix": prefix,
            "selectionStart": prefix ? (query as NSString).length : (suggestion as NSString).length,
            "selectionEnd": (suggestion as NSString).length]
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]))
