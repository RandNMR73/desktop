import AppKit
import SwiftUI

@objc(ChildView) final class PeekTestChildView: NSView {
    var testFlipped = true
    override var isFlipped: Bool { testFlipped }
}

@main struct TestPeekControls {
    @MainActor static func main() throws {
        _ = NSApplication.shared
        var checks = 0
        func check(_ condition: @autoclosure () -> Bool, _ description: String) {
            precondition(condition(), description)
            checks += 1
        }
        // The fixture never orders windows on screen or reads another app.
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 450, height: 300),
                              styleMask: .borderless, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 450, height: 300))
        let child = PeekTestChildView(frame: content.bounds)
        content.addSubview(child)
        window.contentView = content
        let handle = UInt64(UInt(bitPattern: Unmanaged.passUnretained(window).toOpaque()))
        let button: [String: Any] = [
            "kind": "close", "rect": [20.0, 40, 34, 34],
            "fill": ["rgba": [0.670843, 0.165362, -0.048872, 1], "p3": false],
            "foreground": ["rgba": [1.0, 1, 1, 1], "p3": true],
            "scale": 1.0, "radius": 4.0, "shadowOpacity": 0.2, "opacity": 1.0,
            "label": "", "labelSize": 13.0, "labelWidth": 0.0, "labelGap": 8.0, "disabled": false,
        ]
        var request: [String: Any] = ["viewport": [450.0, 300], "buttons": [button]]
        func sync(_ value: [String: Any], owner: UInt32 = 1, target: UInt64? = nil) -> Int32 {
            let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
            return String(decoding: data, as: UTF8.self).withCString {
                peekControlsSync(target ?? handle, owner, $0)
            }
        }
        check(peekControlsVersion() == 1, "capability")
        check(!window.isVisible, "hidden fixture")
        check(sync(request) == 0, "extended color accepted")
        check(child.subviews.count == 1, "one owned rail")
        check(content.subviews.last === child, "accessibility host order preserved")
        let first = child.subviews[0]
        check(first.frame == NSRect(x: 0, y: 10, width: 84, height: 94), "shadow clipped only at viewport edge")
        check(first.subviews[0].frame == NSRect(x: -10, y: 0, width: 94, height: 94), "material keeps position after clipping")
        check(first.hitTest(NSPoint(x: 30, y: 30)) == nil, "native rail passes clicks through")
        check(first.subviews[0].hitTest(NSPoint(x: 40, y: 40)) == nil, "native control passes clicks through")
        check(sync(request) == 0 && child.subviews.first === first, "same request retains existing view")
        check(sync(request, owner: 2) == 0 && child.subviews.count == 2, "owners coexist during replacement")
        check(peekControlsClear(handle, 1) == 0 && child.subviews.count == 1, "old teardown leaves replacement intact")
        check(peekControlsClear(handle, 1) == 0 && child.subviews.count == 1, "stale clear is idempotent")
        check(sync(request, owner: 0) == 3 && child.subviews.count == 1, "invalid owner cannot remove replacement")
        check(sync(request, target: 1) == 2 && child.subviews.count == 1, "unknown window cannot affect paint")
        check(peekControlsClear(handle, 2) == 0 && child.subviews.isEmpty, "clear releases host")
        for (field, value) in [
            ("kind", "unknown" as Any), ("scale", 0), ("radius", 13), ("shadowOpacity", -1),
            ("opacity", 2), ("labelSize", 100), ("label", String(repeating: "x", count: 257)),
            ("rect", [20, 40, 513, 34]), ("rect", [20, 40, 34]),
            ("fill", ["rgba": [0, 0, 0, 2], "p3": false]),
            ("foreground", ["rgba": [0, 0], "p3": false]),
        ] {
            check(sync(request) == 0, "recreate before invalid \(field)")
            var invalid = button; invalid[field] = value
            var bad = request; bad["buttons"] = [invalid]
            check(sync(bad) == 3 && child.subviews.isEmpty, "invalid \(field) clears only its paint")
        }
        request["buttons"] = [button, button]
        check(sync(request) == 3, "duplicate kind rejected")
        request["buttons"] = [button]
        child.testFlipped = false
        check(sync(request) == 0, "unflipped host accepted")
        check(child.subviews[0].frame == NSRect(x: 0, y: 196, width: 84, height: 94), "unflipped coordinates")
        check(child.subviews[0].subviews[0].frame.minY == 0, "unflipped host preserves visual origin")
        var expand = button; expand["kind"] = "expand"; expand["rect"] = [20, 84, 34, 34]
        var split = button; split["kind"] = "split"; split["rect"] = [20, 128, 34, 34]
        request["buttons"] = [button, expand, split]
        check(sync(request) == 0 && child.subviews[0].subviews.count == 3, "all three symbols")
        request["buttons"] = [button]
        check(sync(request) == 0 && child.subviews[0].subviews.count == 1, "removed controls release hosts")
        request["viewport"] = [225.0, 150]
        check(sync(request) == 0, "uniform viewport scaling")
        check(child.subviews[0].subviews[0].frame.size == NSSize(width: 188, height: 188),
              "viewport scaling includes shadow allowance")
        request["viewport"] = [225.0, 300]
        check(sync(request) == 3 && child.subviews.isEmpty, "nonuniform viewport rejected for CSS fallback")
        request["viewport"] = [450.0, 300]
        var offscreen = button; offscreen["rect"] = [-1000, 40, 34, 34]
        request["buttons"] = [offscreen]
        check(sync(request) == 3 && child.subviews.isEmpty, "offscreen rail clears")
        request["buttons"] = [button]
        check(sync(request) == 0, "restore after unsupported viewport")
        for owner: UInt32 in 2...4 { check(sync(request, owner: owner) == 0, "bounded overlapping owner") }
        check(sync(request, owner: 5) == 3 && child.subviews.count == 4, "owner limit")
        for owner: UInt32 in 1...4 { check(peekControlsClear(handle, owner) == 0, "owner teardown") }
        check(child.subviews.isEmpty && !window.isVisible, "no native paint or visible fixture remains")
        window.close()
        if CommandLine.arguments.count > 1 {
            let output = URL(fileURLWithPath: CommandLine.arguments[1])
            try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
            for width in [34.0, 70.0, 110.0] {
                for (name, radius, opacity) in [("idle", 4.0, 0.2), ("early", 4.5, 0.225),
                    ("mid", 5.0, 0.25), ("late", 5.5, 0.275), ("hover", 6.0, 0.3),
                    ("pressed", 4.0, 0.3), ("lower", 3.8, 0.3), ("upper", 6.2, 0.3)] {
                    for scale in [1.0, 2.0] {
                        let view = NativePeekControl(size: CGSize(width: width, height: 34),
                            fill: .black, foreground: .white, symbol: nil, radius: radius,
                            shadowOpacity: opacity).background(Color.white)
                        let renderer = ImageRenderer(content: view); renderer.scale = scale
                        let image = NSBitmapImageRep(cgImage: renderer.cgImage!)
                        try image.representation(using: .png, properties: [:])!.write(to:
                            output.appendingPathComponent("native-\(name)-w\(Int(width))-white-\(Int(scale))x.png"))
                    }
                }
            }
        }
        print("PASS: \(checks) hidden native Peek host checks")
    }
}
