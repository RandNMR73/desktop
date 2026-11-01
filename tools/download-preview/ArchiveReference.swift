import AppKit
import SwiftUI

// Owned reconstruction of the read-only Arc EmptyStateView / PageFilterView
// layout. Outputs are native reference measurements, not Arc screenshots.
struct Frames: PreferenceKey {
 static var defaultValue: [String:CGRect] = [:]
 static func reduce(value: inout [String:CGRect], nextValue: () -> [String:CGRect]) {
  value.merge(nextValue(), uniquingKeysWith: { _, new in new })
 }
}
extension View {
 func measured(_ name: String) -> some View {
  background(GeometryReader { geo in Color.clear.preference(key:Frames.self,
   value:[name:geo.frame(in:.named("reference"))]) })
 }
}
final class Capture { var frames: [String:CGRect] = [:] }
struct EmptyReference: View {
 var body: some View {
  VStack(spacing:16) {
   Image(systemName:"archivebox").resizable().scaledToFit().frame(height:48).measured("hero")
   VStack(spacing:8) {
    Text("Nothing here yet!").font(.system(size:17,weight:.semibold)).measured("title")
    Text("Hover your mouse over a tab and press the × to archive it.")
     .font(.system(size:14)).multilineTextAlignment(.center).frame(maxWidth:270).measured("subtitle")
   }
   Text("Learn more").font(.system(size:13,weight:.medium)).frame(width:101,height:28).measured("button")
  }.measured("empty").frame(maxWidth:.infinity,maxHeight:.infinity)
 }
}
struct FilterReference: View {
 var body: some View {
  VStack {
   HStack(spacing:0) { Text("Filter Archived Tabs").font(.system(size:14,weight:.bold)); Spacer(minLength:0); Text("Done").padding(.horizontal,12) }
    .frame(height:36).padding(.horizontal,12).measured("header")
   ForEach(0..<2) { i in
    VStack(alignment:.leading,spacing:6) {
     Text(i == 0 ? "How was the tab closed?" : "Where was the tab?")
      .font(.system(size:12,weight:.semibold)).padding(.horizontal,12).padding(.top,8).measured("group\(i)heading")
     HStack(spacing:6) {
      Text(i == 0 ? "Auto-Closed" : "Little Arc")
       .font(.system(size:14,weight:.medium)).padding(.vertical,8).padding(.horizontal,12)
      Spacer(minLength:0)
     }.padding(.horizontal,8).measured("group\(i)options")
    }.measured("group\(i)")
   }
  }.padding(.bottom,6).padding(.vertical,10).measured("filter")
 }
}
@MainActor func main() throws {
 _ = NSApplication.shared
 let output = URL(fileURLWithPath:CommandLine.arguments[1])
 let glyph = Image(systemName:"archivebox").resizable().scaledToFit().frame(height:48).foregroundStyle(.white)
 let renderer = ImageRenderer(content:glyph); renderer.scale = 2
 let cg = renderer.cgImage!
 let width=Double(cg.width)/2, height=Double(cg.height)/2
 let data=NSBitmapImageRep(cgImage:cg).representation(using:.png,properties:[:])!
 let svg="""
 <svg xmlns="http://www.w3.org/2000/svg" width="\(width)" height="\(height)" viewBox="0 0 \(width) \(height)">
 <!-- SwiftUI archivebox, resizable aspect fit, 48pt height; native 2x alpha mask. -->
 <defs><mask id="glyph"><image width="\(width)" height="\(height)" href="data:image/png;base64,\(data.base64EncodedString())"/></mask></defs>
 <rect width="100%" height="100%" fill="context-fill" mask="url(#glyph)"/>
 </svg>

 """
 try svg.write(to:output.appendingPathComponent("archive-empty.svg"),atomically:true,encoding:.utf8)
 var results: [String:Any] = ["kind":"Owned native reconstruction; not an Arc screenshot", "symbol":["width":width,"height":height]]
 for (name, view) in [("empty",AnyView(EmptyReference())),("filter",AnyView(FilterReference()))] {
  let capture=Capture()
  let host=NSHostingView(rootView:view.coordinateSpace(name:"reference").onPreferenceChange(Frames.self) { capture.frames=$0 })
  let window=NSWindow(contentRect:CGRect(x:0,y:0,width:300,height:name == "empty" ? 500:240),styleMask:[],backing:.buffered,defer:false)
  window.contentView=host
  for _ in 0..<3 { host._renderForTest(interval:0.01); host.layoutSubtreeIfNeeded(); RunLoop.current.run(until:Date(timeIntervalSinceNow:0.01)) }
  results[name]=capture.frames.mapValues { ["x":$0.minX,"y":$0.minY,"width":$0.width,"height":$0.height] }
 }
 try JSONSerialization.data(withJSONObject:results,options:[.prettyPrinted,.sortedKeys]).write(to:output.appendingPathComponent("native-reference.json"))
 print(String(data:try JSONSerialization.data(withJSONObject:results),encoding:.utf8)!)
}
MainActor.assumeIsolated { try! main() }
