import AppKit
import SwiftUI
func rgba(_ c:NSColor?) -> [CGFloat]? {
 guard let c=c?.usingColorSpace(.sRGB) else{return nil}
 return [c.redComponent,c.greenComponent,c.blueComponent,c.alphaComponent]
}
@MainActor func inspect(_ view:NSView) {
 if let field=view as? NSTextField {
  print("FIELD",String(describing:type(of:field)),"font",field.font as Any,"color",rgba(field.textColor) as Any,"placeholder",field.placeholderString as Any)
  if let text=field.placeholderAttributedString,text.length>0 {print("ATTRS",text.attributes(at:0,effectiveRange:nil))}
 }
 for child in view.subviews {inspect(child)}
}
@MainActor func run() {
 _=NSApplication.shared
 for (name,alpha) in [(NSAppearance.Name.aqua,0.565),(.darkAqua,0.592)] {
  let window=NSWindow(contentRect:NSRect(x:0,y:0,width:260,height:36),styleMask:[.borderless],backing:.buffered,defer:false)
  window.appearance=NSAppearance(named:name)
  let color=NSColor(srgbRed:name == .aqua ? 0:1,green:name == .aqua ? 0:1,blue:name == .aqua ? 0:1,alpha:alpha)
  let host=NSHostingView(rootView:TextField("Search Downloads…",text:.constant("")).textFieldStyle(.plain).font(.system(size:14,weight:.medium)).foregroundColor(Color(nsColor:color)))
  window.contentView=host
  host.frame=NSRect(x:0,y:0,width:260,height:36)
  host.layoutSubtreeIfNeeded()
  RunLoop.current.run(until:Date(timeIntervalSinceNow:0.2))
  host.layoutSubtreeIfNeeded()
  print(name.rawValue)
  window.appearance!.performAsCurrentDrawingAppearance { print("NSPlaceholder",rgba(NSColor.placeholderTextColor)!) }
  inspect(host)
 }
}
MainActor.assumeIsolated {run()}
