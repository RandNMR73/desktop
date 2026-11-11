/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import AppKit
import SwiftUI

@objc(ChildView) final class PeekBenchChildView: NSView {
    override var isFlipped: Bool { true }
}

// Measures only the native bridge and owned offscreen drawing. It never
// orders a window on screen, sends input, or reads another application's UI.
// These timings are not physical frame latency or a browser speed comparison.
@main struct BenchPeekControls {
    @MainActor static func main() throws {
        precondition(CommandLine.arguments.count == 2, "output JSON path required")
        let output = URL(fileURLWithPath: CommandLine.arguments[1])
        precondition(!FileManager.default.fileExists(atPath: output.path), "preserve prior results")
        _ = NSApplication.shared
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 882),
            styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 1280, height: 882))
        let child = PeekBenchChildView(frame: content.bounds)
        content.addSubview(child)
        window.contentView = content
        let handle = UInt64(UInt(bitPattern: Unmanaged.passUnretained(window).toOpaque()))
        let sampleCount = 240, warmupCount = 48
        let scenarios = ["idle", "one-button-hover", "rail-motion", "confirmation-width"]
        func request(_ scenario: String, _ step: Int) -> String {
            let phase = Double(step % 48) / 47
            let amount = (1 - cos(phase * .pi * 2)) / 2
            let rows = ["close", "expand", "split"].enumerated().map { index, kind -> [String: Any] in
                let hover = scenario == "one-button-hover" && index == 2 ? amount : 0
                let offset = scenario == "rail-motion" ? 40 * amount : 0
                let labelWidth = scenario == "confirmation-width" && index == 0 ? 52 * amount : 0
                return ["kind": kind, "rect": [1190 + offset, 20 + Double(index) * 44 - hover, 34 + labelWidth, 34],
                    "fill": ["rgba": [0.02, 0.07, 0.08, 1.0], "p3": true],
                    "foreground": ["rgba": [0.9, 0.98, 1.0, 1.0], "p3": true],
                    "scale": 1.0, "radius": 4 + hover * 2, "shadowOpacity": 0.2 + hover * 0.1,
                    "opacity": 1.0, "label": labelWidth > 0 ? "Close" : "", "labelSize": 13.0,
                    "labelWidth": labelWidth, "labelGap": 8.0, "disabled": false]
            }
            let data = try! JSONSerialization.data(withJSONObject: ["viewport": [1280, 882], "buttons": rows], options: [.sortedKeys])
            return String(decoding: data, as: UTF8.self)
        }
        func stats(_ samples: [Double]) -> [String: Any] {
            let sorted = samples.sorted()
            func percentile(_ p: Double) -> Double { sorted[Int(Double(sorted.count - 1) * p)] }
            return ["samplesMicroseconds": samples, "medianMicroseconds": percentile(0.5),
                "p95Microseconds": percentile(0.95), "p99Microseconds": percentile(0.99),
                "maxMicroseconds": sorted.last!, "meanMicroseconds": samples.reduce(0, +) / Double(samples.count)]
        }
        var results: [[String: Any]] = []
        for scenario in scenarios {
            // Serialization and request generation are outside native timing.
            let requests = (0..<sampleCount + warmupCount).map { request(scenario, $0) }
            var syncTimes: [Double] = [], rasterTimes: [Double] = []
            for (index, json) in requests.enumerated() {
                autoreleasepool {
                    precondition(!window.isVisible, "fixture must remain hidden")
                    let start = DispatchTime.now().uptimeNanoseconds
                    let result = json.withCString { peekControlsSync(handle, 1, $0) }
                    let finish = DispatchTime.now().uptimeNanoseconds
                    precondition(result == 0, "native request failed")
                    // Let pending SwiftUI work settle outside the bridge timer.
                    RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.002))
                    let clip = child.subviews[0]
                    let image = clip.bitmapImageRepForCachingDisplay(in: clip.bounds)!
                    let rasterStart = DispatchTime.now().uptimeNanoseconds
                    clip.cacheDisplay(in: clip.bounds, to: image)
                    let rasterFinish = DispatchTime.now().uptimeNanoseconds
                    if index >= warmupCount {
                        syncTimes.append(Double(finish - start) / 1000)
                        rasterTimes.append(Double(rasterFinish - rasterStart) / 1000)
                    }
                }
            }
            results.append(["scenario": scenario, "nativeSync": stats(syncTimes), "offscreenRaster": stats(rasterTimes)])
            precondition(peekControlsClear(handle, 1) == 0)
        }
        precondition(child.subviews.isEmpty && !window.isVisible)
        window.close()
        let report: [String: Any] = ["format": 1, "samplesPerScenario": sampleCount,
            "warmupPerScenario": warmupCount, "windowWasNeverVisible": true,
            "results": results, "limits": "Owned hidden native fixture; sync excludes JS/FFI and pending work; raster is synchronous offscreen cache drawing, not GPU presentation or physical latency."]
        try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: output)
        print("Recorded \(scenarios.count * sampleCount) native sync and offscreen raster samples")
    }
}
