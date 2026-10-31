import SwiftUI
import AppKit

// Owned static reconstruction of DownloadProgressBadge's read-only modifier trace.
struct ProgressFace: View {
 let progress: Double
 let fill: Color
 let outline: Color
 let foreground: Color
 var body: some View {
  ZStack {
   Circle().fill(fill).frame(width:24,height:24)
    .overlay(Circle().stroke(outline.opacity(0.5),lineWidth:1))
   Image(systemName:"checkmark").font(.system(size:9,weight:.heavy)).foregroundColor(foreground)
   ZStack {
    Circle().stroke(foreground.opacity(0.2),lineWidth:2.5)
    Circle().trim(from:0,to:progress).stroke(foreground,style:StrokeStyle(lineWidth:2.5,lineCap:.round))
     .rotationEffect(.degrees(-90))
   }.opacity(0.5).frame(width:21.5,height:21.5)
  }.frame(width:40,height:40)
 }
}
@MainActor func png<V:View>(_ view:V,scale:CGFloat)->Data {
 let renderer=ImageRenderer(content:view);renderer.scale=scale
 return NSBitmapImageRep(cgImage:renderer.cgImage!).representation(using:.png,properties:[:])!
}
@MainActor func run() throws {
 let out=URL(fileURLWithPath:CommandLine.arguments[1]);
 _ = NSApplication.shared
 let arrow=Image(systemName:"checkmark").font(.system(size:9,weight:.heavy)).foregroundColor(.white).frame(width:40,height:40)
 // Multiple raster resolutions preserve the system glyph's small-size rendering.
 for scale in [1,2,3] {try png(arrow,scale:CGFloat(scale)).write(to:out.appendingPathComponent("checkmark-\(scale).png"))}
 let input=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[2]))) as! [String:Any]
 func color(_ values:Any)->Color {let a=values as! [Double];return Color(nsColor:NSColor(srgbRed:a[0],green:a[1],blue:a[2],alpha:a[3]))}
 for (i,space) in (input["spaces"] as! [[String:Any]]).enumerated() {
  let theme=space["theme"] as! [String:Any], palettes=theme["semantic_palette"] as! [String:Any]
  let palette=palettes[theme["appearance"] as! String] as! [String:Any]
  for p in [1.0] {
   let view=ProgressFace(progress:p,fill:color(palette["cutoutColor"]!),outline:color(palette["foregroundPrimary"]!),foreground:color(palette["maxContrastColor"]!))
   try png(view,scale:2).write(to:out.appendingPathComponent("reference-\(i)-complete.png"))
  }
 }
 print("Rendered five native completion reference badges and three checkmark masks")
}
MainActor.assumeIsolated { try! run() }
