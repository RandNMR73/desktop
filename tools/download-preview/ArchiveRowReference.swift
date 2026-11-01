import AppKit
import SwiftUI

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
struct Row: View {
 var hovered: Bool
 var body: some View {
  HStack(spacing:8) {
   Color.clear.frame(width:16,height:16).measured("favicon")
    .frame(width:24,height:24).measured("accessory")
   VStack(alignment:.leading,spacing:2) {
    Text("Archive row fixture").font(.system(size:14)).lineLimit(1).measured("title")
    Text("example.test/archive").font(.system(size:12)).lineLimit(1).measured("subtitle")
   }.frame(maxWidth:.infinity,alignment:.leading).measured("text")
   HStack(spacing:2) {
    Image(systemName:"trash").font(.system(size:14,weight:.medium))
     .frame(maxWidth:.infinity,maxHeight:.infinity).measured("delete")
    Image(systemName:"arrow.uturn.left").font(.system(size:14,weight:.medium))
     .frame(maxWidth:.infinity,maxHeight:.infinity).measured("restore")
   }.frame(width:hovered ? 66:0,height:32).opacity(hovered ? 1:0).measured("actions")
  }.padding(.horizontal,12).frame(height:56).measured("row")
 }
}
func svgPath(_ path: CGPath) -> String {
 var result = ""
 func point(_ p: CGPoint) -> String { String(format:"%.6f %.6f",p.x,p.y) }
 path.applyWithBlock { element in
  let e=element.pointee
  switch e.type {
  case .moveToPoint: result += "M"+point(e.points[0])+" "
  case .addLineToPoint: result += "L"+point(e.points[0])+" "
  case .addQuadCurveToPoint: result += "Q"+point(e.points[0])+" "+point(e.points[1])+" "
  case .addCurveToPoint: result += "C"+point(e.points[0])+" "+point(e.points[1])+" "+point(e.points[2])+" "
  case .closeSubpath: result += "Z "
  @unknown default: fatalError("Unknown path element")
  }
 }
 return result.trimmingCharacters(in:.whitespaces)
}
@MainActor func main() throws {
 _ = NSApplication.shared
 let output=URL(fileURLWithPath:CommandLine.arguments[1])
 var report:[String:Any] = ["kind":"Owned SwiftUI reconstruction from read-only Arc ContentCell/AccessoryButton layout"]
 for (name,symbol) in [("delete","trash"),("restore","arrow.uturn.left")] {
  let renderer=ImageRenderer(content:Image(systemName:symbol)
   .font(.system(size:14,weight:.medium)).foregroundStyle(.white).frame(width:32,height:32))
  renderer.scale=2
  let data=NSBitmapImageRep(cgImage:renderer.cgImage!).representation(using:.png,properties:[:])!
  let svg="""
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <!-- SwiftUI \(symbol), 14pt medium, centered in 32pt; native 2x alpha mask. -->
  <defs><mask id="glyph"><image width="32" height="32" href="data:image/png;base64,\(data.base64EncodedString())"/></mask></defs>
  <rect width="32" height="32" fill="context-fill" mask="url(#glyph)"/>
  </svg>

  """
  try svg.write(to:output.appendingPathComponent("archive-\(name).svg"),atomically:true,encoding:.utf8)
 }
 for (name,size,radius) in [("row",56.0,12.0),("button",32.0,8.0)] {
  let path=svgPath(RoundedRectangle(cornerRadius:radius,style:.continuous)
   .path(in:CGRect(x:0,y:0,width:size,height:size)).cgPath)
  report[name+"Path"]=path
  let svg="""
  <svg xmlns="http://www.w3.org/2000/svg" width="\(size)" height="\(size)" viewBox="0 0 \(size) \(size)"><path fill="context-fill" d="\(path)"/></svg>

  """
  try svg.write(to:output.appendingPathComponent("archive-\(name)-shape.svg"),atomically:true,encoding:.utf8)
 }
 for hovered in [false,true] {
  let capture=Capture()
  let host=NSHostingView(rootView:Row(hovered:hovered).coordinateSpace(name:"reference")
   .onPreferenceChange(Frames.self) { capture.frames=$0 })
  let window=NSWindow(contentRect:CGRect(x:0,y:0,width:500,height:56),styleMask:[],backing:.buffered,defer:false)
  window.contentView=host
  for _ in 0..<3 { host._renderForTest(interval:0.01);host.layoutSubtreeIfNeeded();RunLoop.current.run(until:Date(timeIntervalSinceNow:0.01)) }
  report[hovered ? "hovered":"normal"]=capture.frames.mapValues { ["x":$0.minX,"y":$0.minY,"width":$0.width,"height":$0.height] }
 }
 let spring=Spring(response:0.18,dampingRatio:0.8)
 report["hoverSpring"]=["duration":spring.settlingDuration,"samples":(0...60).map {
  spring.value(target:1.0,time:Double($0)/60*spring.settlingDuration)
 }]
 try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]).write(to:output.appendingPathComponent("native-reference.json"))
}
MainActor.assumeIsolated { try! main() }
