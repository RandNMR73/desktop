import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 600, height: 120),
                      styleMask: [.titled], backing: .buffered, defer: false)
window.title = "Command caret reference"
let field = NSTextField(frame: NSRect(x: 20, y: 40, width: 560, height: 32))
field.font = .systemFont(ofSize: 18, weight: .medium)
field.stringValue = "browser keyboard"
field.isBezeled = false
field.drawsBackground = false
window.contentView!.addSubview(field)
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
window.makeFirstResponder(field)
(field.currentEditor() as? NSTextView)?.setSelectedRange(NSRange(location: field.stringValue.utf16.count, length: 0))

func recordLayer(_ layer: CALayer) -> [String: Any] {
    ["class": String(describing: type(of: layer)), "bounds": NSStringFromRect(layer.bounds),
     "position": NSStringFromPoint(layer.position), "cornerRadius": layer.cornerRadius,
     "children": (layer.sublayers ?? []).map(recordLayer)]
}
func record(_ view: NSView) -> [String: Any] {
    var result: [String: Any] = ["class": String(describing: type(of: view)),
                                "frame": NSStringFromRect(view.frame),
                                "bounds": NSStringFromRect(view.bounds),
                                "children": view.subviews.map(record)]
    if let layer = view.layer {
        result["layer"] = recordLayer(layer)
    }
    return result
}
DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
    var result = record(window.contentView!.superview!)
    result["font"] = ["ascender": field.font!.ascender,
                       "descender": field.font!.descender,
                       "leading": field.font!.leading,
                       "defaultLineHeight": NSLayoutManager().defaultLineHeight(for: field.font!)]
    let data = try! JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
    FileHandle.standardOutput.write(data)
    window.orderOut(nil)
    exit(0)
}
app.run()
