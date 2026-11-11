/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import AppKit

@objc(ChildView) final class PeekGeometryChildView: NSView {
    override var isFlipped: Bool { true }
}

// Check painted positions against the requested rectangles, independently of
// the native host frames. No window is ordered on screen and no browser is read.
@main struct TestPeekControlGeometry {
    @MainActor static func main() throws {
        precondition(CommandLine.arguments.count == 2, "new JSON output path required")
        let output = URL(fileURLWithPath: CommandLine.arguments[1])
        precondition(!FileManager.default.fileExists(atPath: output.path), "preserve prior evidence")
        _ = NSApplication.shared
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 450, height: 300),
            styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 450, height: 300))
        let child = PeekGeometryChildView(frame: content.bounds)
        content.addSubview(child)
        window.contentView = content
        let handle = UInt64(UInt(bitPattern: Unmanaged.passUnretained(window).toOpaque()))
        let initial: [[String: Any]] = ["close", "expand", "split"].enumerated().map { index, kind in
            ["kind": kind, "rect": [20.0, 20 + Double(index) * 44, 34, 34],
             "fill": ["rgba": [0.02, 0.07, 0.08, 1.0], "p3": false],
             "foreground": ["rgba": [1.0, 1, 1, 1], "p3": false],
             "scale": 1.0, "radius": 4.0, "shadowOpacity": 0.2, "opacity": 1.0,
             "label": "", "labelSize": 13.0, "labelWidth": 0.0, "labelGap": 8.0, "disabled": false]
        }
        var results: [[String: Any]] = []
        var failures: [String] = []
        func frameArray(_ rect: NSRect) -> [Double] { [rect.minX, rect.minY, rect.width, rect.height] }
        func sync(_ request: [String: Any]) -> Int32 {
            let data = try! JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
            return String(decoding: data, as: UTF8.self).withCString { peekControlsSync(handle, 1, $0) }
        }
        func sample(_ name: String, _ rows: [[String: Any]], viewport: [Double]? = nil) {
            let viewport = viewport ?? [content.bounds.width, content.bounds.height]
            let request: [String: Any] = ["viewport": viewport, "buttons": rows]
            precondition(sync(request) == 0 && !window.isVisible)
            let frames = child.subviews[0].subviews.map { frameArray($0.frame) }
            // Yield repeatedly without a new request: an automatic hosting-view
            // resize can otherwise be concealed by the next explicit sync.
            for delay in [0.0, 0.01, 0.05, 0.25] {
                if delay > 0 { RunLoop.main.run(until: Date(timeIntervalSinceNow: delay)) }
                let image = child.bitmapImageRepForCachingDisplay(in: child.bounds)!
                child.cacheDisplay(in: child.bounds, to: image)
                precondition(image.bitsPerSample == 8 && image.bitsPerPixel == 32 &&
                    image.samplesPerPixel == 4 && image.bitmapFormat.rawValue == 0)
                let pixels = image.bitmapData!
                var bands: [[Double]] = []
                var band: [Double]?
                for y in 0..<image.pixelsHigh {
                    var left = image.pixelsWide, right = -1
                    for x in 0..<image.pixelsWide where pixels[y * image.bytesPerRow + x * 4 + 3] >= 110 {
                        left = min(left, x); right = max(right, x)
                    }
                    if right >= left {
                        if let old = band {
                            band = [min(old[0], Double(left)), old[1], max(old[2], Double(right + 1)), Double(y + 1)]
                        } else { band = [Double(left), Double(y), Double(right + 1), Double(y + 1)] }
                    } else if let old = band { bands.append(old); band = nil }
                }
                if let band { bands.append(band) }
                // The controls are separated vertically. Alpha > 110 excludes
                // the <= 0.3 shadow while retaining even the half-opacity fill.
                let sorted = rows.sorted { ($0["rect"] as! [Double])[1] < ($1["rect"] as! [Double])[1] }
                let backingScale = Double(image.pixelsWide) / child.bounds.width
                let cssScale = content.bounds.width / viewport[0]
                let insetTop = content.bounds.height - child.frame.maxY
                let expected = sorted.map { row -> [Double] in
                    let r = row["rect"] as! [Double]
                    return [(r[0] * cssScale - child.frame.minX) * backingScale,
                        (r[1] * cssScale - insetTop) * backingScale,
                        ((r[0] + r[2]) * cssScale - child.frame.minX) * backingScale,
                        ((r[1] + r[3]) * cssScale - insetTop) * backingScale]
                }
                let error: Double? = bands.count == expected.count ? zip(bands, expected).flatMap {
                    zip($0, $1).map { abs($0 - $1) }
                }.max()! : nil
                let after = child.subviews[0].subviews.map { frameArray($0.frame) }
                let stable = after == frames
                // One physical pixel is the fixed raster quantization budget,
                // not a tolerance derived from the candidate's observed error.
                let passed = error.map { $0 <= 1 } == true && stable && !window.isVisible
                if !passed {
                    failures.append("\(name) after \(delay)s: \(bands.count)/\(expected.count) distinct controls, " +
                        "edge error \(error.map(String.init(describing:)) ?? "unmeasurable"), frames stable \(stable)")
                }
                results.append(["name": name, "additionalRunLoopSeconds": delay, "request": request,
                    "contentFrame": frameArray(content.frame), "childFrame": frameArray(child.frame),
                    "hostFramesBefore": frames, "hostFramesAfter": after, "hostFramesStable": stable,
                    "backingScale": backingScale, "paintedBoundsPhysicalPixels": bands,
                    "expectedBoundsPhysicalPixels": expected, "maxEdgeErrorPhysicalPixels": error as Any? ?? NSNull(), "passed": passed])
            }
            // Also exercise the unchanged-request early return after layout.
            precondition(sync(request) == 0 && !window.isVisible)
        }
        sample("titled-initial", initial)
        var hovered = initial
        hovered[1]["rect"] = [20.0, 63, 34, 34]
        hovered[1]["radius"] = 6.0; hovered[1]["shadowOpacity"] = 0.3
        sample("expand-hover", hovered)
        var moved = hovered
        for i in moved.indices { var r = moved[i]["rect"] as! [Double]; r[0] += 110; moved[i]["rect"] = r }
        sample("sidebar-position-open", moved)
        sample("sidebar-position-closed", hovered)
        var labelled = moved
        labelled[0]["rect"] = [130.0, 20, 86, 34]
        labelled[0]["label"] = "Close"; labelled[0]["labelWidth"] = 52.0
        sample("confirmation-label", labelled)
        sample("confirmation-label-removed", moved)
        for (index, size) in [NSSize(width: 640, height: 400), NSSize(width: 450, height: 300)].enumerated() {
            window.setContentSize(size); content.frame.size = size; child.frame = content.bounds
            sample("window-resize-\(index)", moved)
        }
        // Nonzero child origin exercises window-to-Gecko coordinate conversion.
        child.frame = NSRect(x: 10, y: 0, width: 440, height: 290)
        sample("child-inset", moved)
        child.frame = content.bounds
        sample("child-inset-restored", moved)
        window.styleMask = .borderless
        sample("borderless", moved)
        window.styleMask = [.titled, .closable, .resizable, .fullSizeContentView]
        window.titlebarAppearsTransparent = true; window.titleVisibility = .hidden
        sample("titlebar-restored", moved)
        sample("viewport-scale", initial, viewport: [225, 150])
        sample("viewport-scale-restored", initial)
        var pressed = initial
        pressed[2]["rect"] = [20.85, 108.85, 32.3, 32.3]; pressed[2]["scale"] = 0.95
        sample("split-pressed", pressed)
        sample("split-released", initial)
        precondition(peekControlsClear(handle, 1) == 0 && child.subviews.isEmpty && !window.isVisible)
        window.close()
        let report: [String: Any] = ["format": 1, "windowWasNeverVisible": true,
            "scope": "Owned offscreen native geometry; excludes Gecko/FFI and physical display presentation.",
            "operatingSystem": ProcessInfo.processInfo.operatingSystemVersionString,
            "edgeTolerancePhysicalPixels": 1, "samples": results, "failures": failures, "passed": failures.isEmpty]
        try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: output)
        print("\(failures.isEmpty ? "PASS" : "FAIL"): \(results.count) native geometry samples; \(failures.count) failures")
        if !failures.isEmpty { exit(1) }
    }
}
