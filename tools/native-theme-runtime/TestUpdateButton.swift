import AppKit

@objc(ChildView) final class UpdateTestChildView: NSView {
    var testFlipped = true
    override var isFlipped: Bool { testFlipped }
}
@objc(PopupWindow) final class UpdateTestPopup: NSWindow {}

@main struct TestUpdateButton {
    static func main() {
        _ = NSApplication.shared
        var checks = 0
        func check(_ condition: @autoclosure () -> Bool, _ description: String) {
            precondition(condition(), description)
            checks += 1
        }
        func fixture(_ popup: Bool = false) -> (NSWindow, UpdateTestChildView) {
            let frame = NSRect(x: 500, y: 300, width: 450, height: 250)
            let window = popup ? UpdateTestPopup(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
                : NSWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            let content = NSView(frame: NSRect(origin: .zero, size: frame.size))
            let child = UpdateTestChildView(frame: content.bounds)
            content.addSubview(child)
            window.contentView = content
            return (window, child)
        }
        let (window, child) = fixture(), (other, _) = fixture()
        let handle = UInt64(UInt(bitPattern: Unmanaged.passUnretained(window).toOpaque()))
        var request: [String: Any] = [
            "rect": [16.0, 100, 196, 24], "clip": [8.0, 90, 212, 64], "viewport": [450.0, 250],
            "rgba": [0.670843, 0.165362, -0.048872, 1], "p3": false,
            "label": "Restart and Update", "dark": false, "pressed": false, "disabled": false, "animate": false,
        ]
        func sync(_ value: [String: Any], _ owner: UInt64? = nil) -> Int32 {
            let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
            return String(decoding: data, as: UTF8.self).withCString { updateButtonSync(owner ?? handle, $0) }
        }
        check(updateButtonVersion() == 1, "capability")
        check(sync(request) == 0, "extended-sRGB color accepted")
        check(child.subviews.count == 1, "one decoration inserted inside ChildView")
        let view = child.subviews[0]
        check(window.contentView?.subviews.last === child, "Gecko accessibility host remains last child")
        check(view.frame == NSRect(x: 16, y: 100, width: 196, height: 24), "flipped coordinates")
        check(view.hitTest(NSPoint(x: 30, y: 110)) == nil, "native paint never intercepts clicks")
        check(sync(request) == 0 && child.subviews.first === view, "unchanged sync reuses the host")
        request["clip"] = [8.0, 110, 212, 20]
        check(sync(request) == 0 && view.frame.height == 14, "opening animation clips the button")
        check(view.subviews.first?.frame.minY == -10, "clipped button keeps its position")
        child.testFlipped = false
        check(sync(request) == 0 && view.frame.minY == 126, "nonflipped native host coordinates")
        check(view.subviews.first?.frame.minY == -10, "nonflipped clip keeps the same visible part")
        request["rect"] = [-20.0, 100, 196, 24]
        check(sync(request) == 0 && view.frame.minX == 8 && view.frame.width == 168,
              "partially revealed sidebar clips native paint at the viewport edge")
        request["rect"] = [16.0, 100, 196, 24]
        check(sync(request, 1) == 2 && child.subviews.first === view, "unknown handle cannot affect another window")
        request["rgba"] = [1, 0, 0, 0.5]
        check(sync(request) == 3 && child.subviews.isEmpty, "unsupported alpha clears paint for CSS fallback")
        request["rgba"] = [0.1921568627, 0.2235294118, 0.9843137255, 1]
        request["p3"] = true
        check(sync(request) == 0, "achromatic Space fallback retains Display P3")
        request["label"] = "Unrecognized label"
        check(sync(request) == 3 && child.subviews.isEmpty, "unknown label fails closed")
        request["label"] = "Try Again"
        request["rect"] = [16, 100, 20000, 24]
        check(sync(request) == 3, "unbounded geometry rejected")
        request["rect"] = [16, 100, 196, 24]
        let (popup, popupChild) = fixture(true)
        window.addChildWindow(popup, ordered: .above)
        popup.orderBack(nil)
        let screenTop = NSScreen.screens.first!.frame.maxY
        request["popup"] = [popup.frame.minX, screenTop - popup.frame.maxY, popup.frame.width, popup.frame.height]
        check(sync(request) == 0 && popupChild.subviews.count == 1 && child.subviews.isEmpty,
              "floating sidebar moves the same decoration to its owned popup")
        window.removeChildWindow(popup)
        other.addChildWindow(popup, ordered: .above)
        check(sync(request) == 3 && popupChild.subviews.isEmpty, "unrelated popup cannot receive paint")
        other.removeChildWindow(popup)
        request.removeValue(forKey: "popup")
        check(sync(request) == 0, "return to pinned sidebar")
        check(updateButtonClear(handle) == 0 && child.subviews.isEmpty, "collapse tears down the animated host")
        check(updateButtonClear(handle) == 0, "clear is idempotent")
        popup.close(); other.close(); window.close()
        print("PASS: \(checks) native update-button checks")
    }
}
