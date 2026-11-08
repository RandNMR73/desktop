import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 600, height: 120),
                      styleMask: [.titled], backing: .buffered, defer: false)
window.title = "Command caret reference"
let field = NSTextField(frame: NSRect(x: 20, y: 40, width: 560, height: 32))
let text = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "browser keyboard"
let pointSize = CommandLine.arguments.count > 2 ? Double(CommandLine.arguments[2])! : 18
field.font = .systemFont(ofSize: pointSize, weight: .medium)
field.stringValue = text
field.isBezeled = false
field.drawsBackground = false
window.contentView!.addSubview(field)
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
window.makeFirstResponder(field)
(field.currentEditor() as? NSTextView)?.setSelectedRange(NSRange(location: field.stringValue.utf16.count, length: 0))

func recordLayer(_ layer: CALayer) -> [String: Any] {
    var value: [String: Any] = ["class": String(describing: type(of: layer)), "bounds": NSStringFromRect(layer.bounds),
     "position": NSStringFromPoint(layer.position), "cornerRadius": layer.cornerRadius,
     "opacity": layer.opacity, "shadowOpacity": layer.shadowOpacity,
     "shadowRadius": layer.shadowRadius, "shadowOffset": NSStringFromSize(layer.shadowOffset),
     "backgroundColor": layer.backgroundColor?.components ?? [],
     "animations": (layer.animationKeys() ?? []).map { key -> [String: Any] in
         let animation = layer.animation(forKey: key)!
         var item: [String: Any] = ["key": key, "type": String(describing: type(of: animation)),
            "duration": animation.duration, "beginTime": animation.beginTime,
            "repeatCount": String(animation.repeatCount), "autoreverses": animation.autoreverses,
            "fillMode": animation.fillMode.rawValue,
            "timingFunction": String(describing: animation.timingFunction)]
         if let basic = animation as? CABasicAnimation {
             item["keyPath"] = basic.keyPath
             item["from"] = String(describing: basic.fromValue)
             item["to"] = String(describing: basic.toValue)
         }
         if let frames = animation as? CAKeyframeAnimation {
             item["keyPath"] = frames.keyPath
             item["values"] = String(describing: frames.values)
             item["keyTimes"] = String(describing: frames.keyTimes)
         }
         return item
     },
     "children": (layer.sublayers ?? []).map(recordLayer)]
    if let shape = layer as? CAShapeLayer {
        value["shape"] = ["fill": shape.fillColor?.components ?? [],
                          "stroke": shape.strokeColor?.components ?? [],
                          "lineWidth": shape.lineWidth] as [String: Any]
    }
    return value
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
let captureDelay = CommandLine.arguments.count > 3 ? Double(CommandLine.arguments[3])! : 0.3
DispatchQueue.main.asyncAfter(deadline: .now() + captureDelay) {
    var result = record(window.contentView!.superview!)
    result["input"] = ["text": text, "pointSize": pointSize] as [String: Any]
    result["captureDelay"] = captureDelay
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
