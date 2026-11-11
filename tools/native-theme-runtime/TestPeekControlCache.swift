/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import AppKit
import CryptoKit

@objc(ChildView) final class PeekCacheChild: NSView {
    var testFlipped = true
    override var isFlipped: Bool { testFlipped }
}
final class PeekCacheContent: NSView {
    var testFlipped = false
    override var isFlipped: Bool { testFlipped }
}

// Reusing an identical request after native layout changes must paint exactly
// as a newly created rail. This owns a hidden window and never reads another app.
@main struct TestPeekControlCache {
    @MainActor static func main() throws {
        precondition(CommandLine.arguments.count == 2, "new output JSON required")
        let output = URL(fileURLWithPath: CommandLine.arguments[1])
        precondition(!FileManager.default.fileExists(atPath: output.path), "preserve prior evidence")
        _ = NSApplication.shared
        let size = NSSize(width: 450, height: 300)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.titlebarAppearsTransparent = true
        let content = PeekCacheContent(frame: NSRect(origin: .zero, size: size))
        let child = PeekCacheChild(frame: content.bounds)
        content.addSubview(child); window.contentView = content
        let handle = UInt64(UInt(bitPattern: Unmanaged.passUnretained(window).toOpaque()))
        let buttons: [[String: Any]] = ["close", "expand", "split"].enumerated().map { index, kind in
            ["kind": kind, "rect": [170.0, 70 + Double(index) * 44, 34, 34],
             "fill": ["rgba": [0.02, 0.07, 0.08, 1.0], "p3": true],
             "foreground": ["rgba": [0.9, 0.98, 1.0, 1.0], "p3": true],
             "scale": 1.0, "radius": 4.0, "shadowOpacity": 0.2, "opacity": 1.0,
             "label": "", "labelSize": 13.0, "labelWidth": 0.0, "labelGap": 8.0, "disabled": false]
        }
        let data = try JSONSerialization.data(withJSONObject: ["viewport": [450, 300], "buttons": buttons], options: [.sortedKeys])
        let request = String(decoding: data, as: UTF8.self)
        func sync() { precondition(request.withCString { peekControlsSync(handle, 1, $0) } == 0) }
        func rect(_ value: NSRect) -> [Double] { [value.minX, value.minY, value.width, value.height] }
        func frames() -> [[Double]] {
            let clip = child.subviews[0]
            return [rect(clip.frame)] + clip.subviews.map { rect($0.frame) }
        }
        func capture() -> Data {
            precondition(!window.isVisible)
            RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
            child.needsDisplay = true
            let image = child.bitmapImageRepForCachingDisplay(in: child.bounds)!
            child.cacheDisplay(in: child.bounds, to: image)
            precondition(image.bitsPerPixel == 32 && image.samplesPerPixel == 4 &&
                image.bitsPerSample == 8 && image.bitmapFormat.rawValue == 0)
            var pixels = Data()
            for y in 0..<image.pixelsHigh {
                pixels.append(image.bitmapData! + y * image.bytesPerRow, count: image.pixelsWide * 4)
            }
            return pixels
        }
        func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
        func containsInk(_ data: Data) -> Bool { stride(from: 3, to: data.count, by: 4).contains { data[$0] > 200 } }
        var samples: [[String: Any]] = []
        func sample(_ name: String, _ change: () -> Void) {
            change(); sync()
            let reused = capture(), reusedFrames = frames()
            precondition(peekControlsClear(handle, 1) == 0 && child.subviews.isEmpty)
            sync()
            let fresh = capture(), freshFrames = frames()
            samples.append(["name": name, "pixelsExact": reused == fresh, "framesExact": reusedFrames == freshFrames,
                "reusedContainsInk": containsInk(reused), "freshContainsInk": containsInk(fresh),
                "reusedSHA256": hash(reused), "freshSHA256": hash(fresh),
                "reusedFrames": reusedFrames, "freshFrames": freshFrames,
                "contentBounds": rect(content.bounds), "childFrame": rect(child.frame), "childBounds": rect(child.bounds)])
        }
        sync()
        sample("unchanged") {}
        sample("child-frame-inset") { child.frame = NSRect(x: 10, y: 10, width: 430, height: 280) }
        sample("child-frame-restored") { child.frame = content.bounds }
        sample("child-bounds-origin") { child.bounds.origin = NSPoint(x: 20, y: 10) }
        sample("child-bounds-restored") { child.bounds = NSRect(origin: .zero, size: size) }
        sample("child-bounds-scale") { child.bounds.size = NSSize(width: 360, height: 240) }
        sample("child-scale-restored") { child.bounds = NSRect(origin: .zero, size: size) }
        sample("child-unflipped") { child.testFlipped = false }
        sample("child-flip-restored") { child.testFlipped = true }
        sample("content-bounds-origin") { content.bounds.origin = NSPoint(x: 8, y: 4) }
        sample("content-bounds-restored") { content.bounds.origin = .zero }
        sample("content-flipped") { content.testFlipped = true }
        sample("content-flip-restored") { content.testFlipped = false }
        sample("native-resize") {
            window.setContentSize(NSSize(width: 675, height: 450))
            content.frame.size = NSSize(width: 675, height: 450); child.frame = content.bounds
        }
        sample("native-size-restored") { window.setContentSize(size); content.frame.size = size; child.frame = content.bounds }
        sample("child-frame-rotation") { child.frameRotation = 5 }
        sample("child-frame-rotation-restored") { child.frameRotation = 0; child.frame = content.bounds }
        sample("child-bounds-rotation") { child.boundsRotation = 5 }
        sample("child-bounds-rotation-restored") { child.boundsRotation = 0; child.bounds = NSRect(origin: .zero, size: size) }
        sample("child-nonuniform-units") { child.scaleUnitSquare(to: NSSize(width: 1.25, height: 0.8)) }
        sample("child-units-restored") { child.bounds = NSRect(origin: .zero, size: size) }
        precondition(peekControlsClear(handle, 1) == 0 && child.subviews.isEmpty && !window.isVisible)
        window.close()
        let failed = samples.filter { !($0["pixelsExact"] as! Bool) || !($0["framesExact"] as! Bool) ||
            !($0["reusedContainsInk"] as! Bool) || !($0["freshContainsInk"] as! Bool) }
        let report: [String: Any] = ["format": 1, "windowWasNeverVisible": true,
            "passed": failed.isEmpty, "samples": samples, "failures": failed.map { $0["name"]! },
            "scope": "Hidden native paint and frames compared to a fresh rail after identical native transformations; not Arc parity or physical presentation."]
        try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys, .prettyPrinted]).write(to: output)
        print("\(failed.isEmpty ? "PASS" : "FAIL"): \(samples.count) cached/fresh native comparisons; \(failed.count) failures")
        if !failed.isEmpty { exit(1) }
    }
}
