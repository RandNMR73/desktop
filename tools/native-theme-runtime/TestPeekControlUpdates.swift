/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import AppKit
import CryptoKit

@objc(ChildView) final class PeekUpdatesChildView: NSView {
    override var isFlipped: Bool { true }
}

// Render a changing, reused rail in a hidden titled window. Comparing these
// artifacts between builds catches stale glyphs, palette, label and geometry
// that static independent shape tests cannot exercise.
@main struct TestPeekControlUpdates {
    @MainActor static func main() throws {
        precondition(CommandLine.arguments.count == 2, "new output directory required")
        let output = URL(fileURLWithPath: CommandLine.arguments[1])
        precondition(!FileManager.default.fileExists(atPath: output.path), "preserve prior artifacts")
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        _ = NSApplication.shared
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 450, height: 300),
            styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 450, height: 300))
        let child = PeekUpdatesChildView(frame: content.bounds)
        content.addSubview(child)
        window.contentView = content
        let handle = UInt64(UInt(bitPattern: Unmanaged.passUnretained(window).toOpaque()))
        let initial: [[String: Any]] = ["close", "expand", "split"].enumerated().map { index, kind in
            ["kind": kind, "rect": [20.0, 20 + Double(index) * 44, 34, 34],
             "fill": ["rgba": [0.02, 0.07, 0.08, 1.0], "p3": true],
             "foreground": ["rgba": [0.9, 0.98, 1.0, 1.0], "p3": true],
             "scale": 1.0, "radius": 4.0, "shadowOpacity": 0.2, "opacity": 1.0,
             "label": "", "labelSize": 13.0, "labelWidth": 0.0, "labelGap": 8.0, "disabled": false]
        }
        var cases: [(String, [[String: Any]], [Double])] = [("initial", initial, [450, 300])]
        func append(_ name: String, _ rows: [[String: Any]]) { cases.append((name, rows, [450, 300])) }
        for step in 0..<12 {
            let amount = (1 - cos(Double(step) / 11 * .pi * 2)) / 2
            var rows = initial
            rows[2]["rect"] = [20, 108 - amount, 34, 34]
            rows[2]["radius"] = 4 + 2 * amount
            rows[2]["shadowOpacity"] = 0.2 + 0.1 * amount
            append("hover-\(step)", rows)
        }
        for step in 0..<8 {
            var rows = initial
            for index in rows.indices { rows[index]["rect"] = [20 + Double(step) * 4, 20 + Double(index) * 44, 34, 34] }
            append("move-\(step)", rows)
        }
        for (index, width) in [0.0, 10, 30, 52, 30, 0].enumerated() {
            var rows = initial
            rows[0]["rect"] = [20, 20, 34 + width, 34]
            rows[0]["label"] = width > 0 ? "Close" : ""
            rows[0]["labelWidth"] = width
            append("label-\(index)", rows)
        }
        for (index, fill) in [[1.0, 0, 0, 1], [0, 0.8, 0.2, 1], [0.2, 0.1, 1, 1], [1, 1, 1, 1]].enumerated() {
            var rows = initial
            for i in rows.indices { rows[i]["fill"] = ["rgba": fill, "p3": true] }
            rows[0]["foreground"] = ["rgba": [0.0, 0, 0, 1], "p3": true]
            append("palette-\(index)", rows)
        }
        var pressed = initial
        pressed[2]["rect"] = [20.85, 108.85, 32.3, 32.3]; pressed[2]["scale"] = 0.95
        append("pressed", pressed)
        var disabled = initial; disabled[1]["disabled"] = true; append("disabled", disabled)
        var translucent = initial; translucent[2]["opacity"] = 0.5; append("opacity", translucent)
        append("reordered", Array(initial.reversed()))
        append("removed", Array(initial.prefix(1)))
        append("restored", initial)
        cases.append(("viewport-scale", initial, [225, 150]))
        append("viewport-restored", initial)
        var results: [[String: Any]] = []
        for (name, buttons, viewport) in cases {
            let request: [String: Any] = ["viewport": viewport, "buttons": buttons]
            let data = try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
            let status = String(decoding: data, as: UTF8.self).withCString { peekControlsSync(handle, 1, $0) }
            precondition(status == 0 && !window.isVisible)
            RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.025))
            let image = child.bitmapImageRepForCachingDisplay(in: child.bounds)!
            child.cacheDisplay(in: child.bounds, to: image)
            let pixels = Data(bytes: image.bitmapData!, count: image.bytesPerRow * image.pixelsHigh)
            let filename = name + ".rgba"
            try pixels.write(to: output.appendingPathComponent(filename))
            try image.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent(name + ".png"))
            results.append(["name": name, "request": request, "pixels": filename,
                "width": image.pixelsWide, "height": image.pixelsHigh, "bytesPerRow": image.bytesPerRow,
                "bitsPerSample": image.bitsPerSample, "bitsPerPixel": image.bitsPerPixel,
                "bitmapFormat": image.bitmapFormat.rawValue, "samplesPerPixel": image.samplesPerPixel,
                "sha256": SHA256.hash(data: pixels).map { String(format: "%02x", $0) }.joined()])
        }
        precondition(peekControlsClear(handle, 1) == 0 && child.subviews.isEmpty && !window.isVisible)
        window.close()
        let report: [String: Any] = ["format": 1, "windowWasNeverVisible": true, "frames": results]
        try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("frames.json"))
        print("Rendered \(cases.count) successive native control states")
    }
}
