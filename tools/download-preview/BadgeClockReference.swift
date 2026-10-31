import SwiftUI
import AppKit

// Reconstruct only the layout modifiers established by the read-only trace.
// This is an owned, offscreen SwiftUI fixture, not injected into Arc.
struct BadgeRow: View {
  let details: Bool
  var body: some View {
    HStack(spacing: 0) {
      Color(red: 1, green: 0, blue: 0).frame(width: 40, height: 40)
      if details {
        Color.clear.frame(width: 12)
        VStack(alignment: .leading, spacing: 0) {
          Text("speedometer-3-2026-result.json").font(.system(size: 14))
          Text("5 days ago").font(.system(size: 12))
        }.lineLimit(1)
        Spacer(minLength: 0)
      }
    }.padding(.horizontal, 4).padding(.vertical, 4)
  }
}


final class BadgeModel: ObservableObject { @Published var expanded=false }
struct AnimatedBadge: View {
 @ObservedObject var model: BadgeModel
 var body: some View {
  Color.white.frame(width:320,height:320).overlay(alignment:.bottomLeading) {
   Color.clear.frame(width:32,height:32).overlay(alignment:.bottomLeading) {
    VStack(alignment:.leading,spacing:0) {
     BadgeRow(details:model.expanded)
      .frame(width:model.expanded ? 212 : 40,height:56)
      .scaleEffect(model.expanded ? 1 : 0.55)
      .offset(x:model.expanded ? 0 : 10,y:model.expanded ? 0 : 30)
      .animation(.linear(duration:1),value:model.expanded)
    }.offset(x:-4,y:-30)
   }.padding(.leading,8).padding(.bottom,8)
  }
 }
}
func bounds(_ image:CGImage)->[String:Any] {
  let w=image.width,h=image.height
  var pixels=[UInt8](repeating:0,count:w*h*4)
  let color=CGColorSpaceCreateDeviceRGB()
  let context=CGContext(data:&pixels,width:w,height:h,bitsPerComponent:8,bytesPerRow:w*4,space:color,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.draw(image,in:CGRect(x:0,y:0,width:w,height:h))
  var xs=[Int](),ys=[Int]()
  var weight=0.0,cx=0.0,cy=0.0
  for y in 0..<h { for x in 0..<w {
    let p=(y*w+x)*4
    let a=Double(max(0,Int(pixels[p])-max(Int(pixels[p+1]),Int(pixels[p+2]))))/255
    weight+=a;cx+=(Double(x)+0.5)*a;cy+=(Double(y)+0.5)*a
    if pixels[p]>220 && pixels[p+1]<30 && pixels[p+2]<30 { xs.append(x);ys.append(y) }
  }}
  guard let x0=xs.min(),let x1=xs.max(),let y0=ys.min(),let y1=ys.max() else { fatalError("No badge") }
  return ["centerX":cx/weight/2,"centerY":cy/weight/2,"redArea":weight/4,"x":Double(x0)/2,"y":Double(y0)/2,"width":Double(x1-x0+1)/2,"height":Double(y1-y0+1)/2]
}
@MainActor func run() throws {
 let model=BadgeModel()
 _ = NSApplication.shared
 let host=NSHostingView(rootView:AnimatedBadge(model:model))
 host.frame=CGRect(x:0,y:0,width:320,height:320)
 let window=NSWindow(contentRect:host.frame,styleMask:[],backing:.buffered,defer:false)
 window.contentView=host
 func snapshot()->CGImage {
  host._renderForTest(interval: 0);host.layoutSubtreeIfNeeded();host.displayIfNeeded()
  let bitmap=host.bitmapImageRepForCachingDisplay(in:host.bounds)!
  host.cacheDisplay(in:host.bounds,to:bitmap)
  return bitmap.cgImage!
 }
 var result:[[String:Any]]=[]
 result.append(["time":-1,"bounds":bounds(snapshot())])
 model.expanded=true
 var elapsed=0.0
 for _ in 0..<64 {
  host._renderForTest(interval: 0.02)
  elapsed+=0.02
  result.append(["time":elapsed,"bounds":bounds(snapshot())])
 }
 FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]))
}
MainActor.assumeIsolated { try! run() }
