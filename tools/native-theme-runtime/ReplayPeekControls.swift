/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import AppKit
import CryptoKit
import Darwin

@objc(ChildView) final class PeekReplayChild: NSView {
    override var isFlipped: Bool { true }
}

private typealias Sync = @convention(c) (UInt64, UInt32, UnsafePointer<CChar>?) -> Int32
private typealias Clear = @convention(c) (UInt64, UInt32) -> Int32

@MainActor private final class ReplayTarget {
    let window: NSWindow
    let child: NSView
    let handle: UInt64
    let sync: Sync
    let clear: Clear

    init(library: String, size: NSSize) {
        guard let library = dlopen(library, RTLD_NOW | RTLD_LOCAL),
              let sync = dlsym(library, "zen_peek_controls_sync"),
              let clear = dlsym(library, "zen_peek_controls_clear") else {
            fatalError("Cannot load native test library")
        }
        // Keep the library loaded until process exit: AppKit can retain its
        // hosting-view classes after their windows have been released.
        self.sync = unsafeBitCast(sync, to: Sync.self)
        self.clear = unsafeBitCast(clear, to: Clear.self)
        let frame = NSRect(origin: .zero, size: size)
        window = NSWindow(contentRect: frame,
            styleMask: [.titled, .closable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        let content = NSView(frame: frame)
        child = PeekReplayChild(frame: frame)
        content.addSubview(child)
        window.contentView = content
        handle = UInt64(UInt(bitPattern: Unmanaged.passUnretained(window).toOpaque()))
    }

    func reset() {
        precondition(!window.isVisible)
        precondition(clear(handle, 1) == 0 && child.subviews.isEmpty)
    }

    func measure(_ json: String) -> Double {
        precondition(!window.isVisible)
        return json.withCString { pointer in
            let start = DispatchTime.now().uptimeNanoseconds
            let status = sync(handle, 1, pointer)
            let end = DispatchTime.now().uptimeNanoseconds
            precondition(status == 0, "Recorded native request failed")
            return Double(end - start) / 1000
        }
    }

    func bitmap() -> (Data, [String], Int, Int) {
        precondition(!window.isVisible && child.subviews.count == 1)
        let clip = child.subviews[0]
        let image = clip.bitmapImageRepForCachingDisplay(in: clip.bounds)!
        clip.cacheDisplay(in: clip.bounds, to: image)
        let data = Data(bytes: image.bitmapData!, count: image.bytesPerRow * image.pixelsHigh)
        precondition(data.contains { $0 != 0 }, "Require visible painted controls")
        let frames = [NSStringFromRect(clip.frame)] + clip.subviews.map { NSStringFromRect($0.frame) }
        return (data, frames, image.pixelsWide, image.pixelsHigh)
    }
}

// Replays recorded Gecko requests and clears in two owned hidden windows.
// Both versions receive the same event before the next event is scheduled.
// Alternating their order reduces drift; it does not measure browser latency.
@main struct ReplayPeekControls {
    @MainActor static func main() throws {
        precondition(CommandLine.arguments.count == 5,
            "trace JSON, baseline dylib, candidate dylib, output JSON required")
        let args = CommandLine.arguments
        let output = URL(fileURLWithPath: args[4])
        precondition(!FileManager.default.fileExists(atPath: output.path))
        let traceData = try Data(contentsOf: URL(fileURLWithPath: args[1]))
        let trace = try JSONSerialization.jsonObject(with: traceData) as! [String: Any]
        precondition(trace["passed"] as? Bool == true)
        let observations = trace["observations"] as! [[String: Any]]
        let firstEvents = observations[0]["events"] as! [[String: Any]]
        let first = firstEvents.first { $0["kind"] as? String == "sync" }!["json"] as! String
        let request = try JSONSerialization.jsonObject(with: Data(first.utf8)) as! [String: Any]
        let viewport = request["viewport"] as! [Double]
        _ = NSApplication.shared
        let size = NSSize(width: viewport[0], height: viewport[1])
        let targets = [ReplayTarget(library: args[2], size: size),
                       ReplayTarget(library: args[3], size: size)]
        for event in firstEvents.filter({ $0["kind"] as? String == "sync" }).prefix(48) {
            for target in targets { _ = target.measure(event["json"] as! String) }
            RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.002))
        }
        targets.forEach { $0.reset() }
        var runs: [[String: Any]] = [], pixels: [[String: Any]] = []
        for repetition in 0..<4 {
            var samples: [[String: Any]] = []
            var clearCount = 0
            for (observationIndex, observation) in observations.enumerated() {
                targets.forEach { $0.reset() }
                let events = observation["events"] as! [[String: Any]]
                let start = DispatchTime.now().uptimeNanoseconds
                var previous: String?
                for (eventIndex, event) in events.enumerated() {
                    let scheduledMs = event["timeMs"] as! Double
                    let elapsedMs = Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
                    if scheduledMs > elapsedMs {
                        RunLoop.main.run(until: Date(timeIntervalSinceNow: (scheduledMs - elapsedMs) / 1000))
                    }
                    let lateMs = max(0, Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000 - scheduledMs)
                    if event["kind"] as? String == "clear" {
                        targets.forEach { $0.reset() }
                        clearCount += 1
                        previous = nil
                        continue
                    }
                    let json = event["json"] as! String
                    let duplicate = event["duplicate"] as! Bool
                    precondition(duplicate == (json == previous), "Trace must preserve clears and exact JSON")
                    previous = json
                    let order = (repetition + observationIndex + eventIndex) % 2 == 0 ? [0, 1] : [1, 0]
                    var times = [0.0, 0.0]
                    for targetIndex in order { times[targetIndex] = targets[targetIndex].measure(json) }
                    samples.append(["observation": observationIndex, "event": eventIndex,
                        "phase": event["phase"]!, "duplicate": duplicate,
                        "baselineMicroseconds": times[0], "candidateMicroseconds": times[1],
                        "baselineFirst": order[0] == 0, "scheduleLateMs": lateMs])
                    // Check the settled end of every phase in the first pass.
                    // Painting and its short settling wait are outside timing.
                    let next = eventIndex + 1 < events.count ? events[eventIndex + 1] : nil
                    if repetition == 0 && (next?["phase"] as? String != event["phase"] as? String
                        || next?["kind"] as? String == "clear") {
                        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.002))
                        let a = targets[0].bitmap(), b = targets[1].bitmap()
                        let exact = a.0 == b.0 && a.1 == b.1 && a.2 == b.2 && a.3 == b.3
                        pixels.append(["observation": observationIndex, "event": eventIndex,
                            "phase": event["phase"]!, "exact": exact,
                            "baselineSHA256": SHA256.hash(data: a.0).map { String(format: "%02x", $0) }.joined(),
                            "candidateSHA256": SHA256.hash(data: b.0).map { String(format: "%02x", $0) }.joined()])
                    }
                }
                targets.forEach { $0.reset() }
            }
            runs.append(["repetition": repetition, "samples": samples, "clearsPerTarget": clearCount])
            print("Completed paired replay \(repetition + 1): \(samples.count) requests, \(clearCount) clears")
            fflush(stdout)
        }
        for target in targets { target.reset(); target.window.close() }
        let report: [String: Any] = ["format": 1, "windowWasNeverVisible": true,
            "traceSHA256": SHA256.hash(data: traceData).map { String(format: "%02x", $0) }.joined(),
            "runs": runs, "paintedPhaseChecks": pixels,
            "limits": "Recorded headless Gecko workload in two hidden native windows with alternating call order. Native sync excludes string preparation, Gecko/JS/FFI, pending SwiftUI work and GPU presentation. Phase-end offscreen pixels are not Arc or physical-screen parity. Other system load was not controlled."]
        try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: output)
    }
}
