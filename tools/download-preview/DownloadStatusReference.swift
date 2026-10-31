import Foundation

// Reconstruct the reflected DownloadData.Status cases in their original order.
// This probes the native enum representation, not the production Arc process.
enum Status {
    case inProgress(Double)
    case paused(Double)
    case notStarted
    case completed
    case failed
    case cancelled
}

let cases: [(String, Status)] = [
    ("inProgress", .inProgress(0.5)), ("paused", .paused(0.5)),
    ("notStarted", .notStarted), ("completed", .completed),
    ("failed", .failed), ("cancelled", .cancelled),
]
let result = cases.map { name, value -> [String: Any] in
    withUnsafeBytes(of: value) { bytes in
        let payload = bytes.loadUnaligned(as: UInt64.self)
        let tag = bytes[8]
        // The read-only Arc branch at 0x10269ba40 dispatches exactly this way.
        let artwork = tag == 0 ? "progress" : tag == 1 || payload != 1 ? "empty" : "file"
        return ["status": name, "payload": String(payload), "tag": tag, "artwork": artwork]
    }
}
let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
print("")
