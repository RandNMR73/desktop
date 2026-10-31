import AppKit
let bundle = Bundle(path: "/Applications/Arc.app/Contents/Resources/ARC_BaseHomeComponents.bundle")!
var result = [String: [String: [CGFloat]]]()
for mode in [NSAppearance.Name.aqua, .darkAqua] {
 NSAppearance(named: mode)!.performAsCurrentDrawingAppearance {
  for name in ["Background", "Background2"] {
   guard let c = NSColor(named: name, bundle: bundle)?.usingColorSpace(.extendedSRGB) else { continue }
   result[mode.rawValue, default: [:]][name] = [c.redComponent,c.greenComponent,c.blueComponent,c.alphaComponent]
  }
 }
}
print(String(data: try! JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted,.sortedKeys]), encoding:.utf8)!)
