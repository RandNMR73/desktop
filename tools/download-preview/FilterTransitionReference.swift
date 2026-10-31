import SwiftUI
import AppKit

// Owned reconstruction of PageHeaderView's conditional branch and common frame.
// Diagnostic colors measure default SwiftUI transition/layout; these are not
// screenshots or frame samples of production Arc.
let overlap = CommandLine.arguments.dropFirst(2).contains("overlap")
final class Model: ObservableObject { @Published var filtering = false }
struct Reference: View {
 @ObservedObject var model: Model
 var body: some View {
  VStack(spacing: 0) {
   Group {
    if model.filtering {
     (overlap ? Color.green : Color(red:0,green:1,blue:0))
      .frame(width:overlap ? nil : 100,height:100).frame(maxWidth:.infinity,alignment:.trailing).padding(.vertical, 10)
    } else {
     VStack(spacing: 6) { (overlap ? Color.red : Color(red:1,green:0,blue:0))
      .frame(width:overlap ? nil : 100,height:36).frame(maxWidth:.infinity,alignment:.leading) }
      .padding(.horizontal, 8).padding(.vertical, 10)
    }
   }.frame(maxWidth: .infinity, alignment: .center)
   Color(red:0,green:0,blue:1).frame(height:4)
   Spacer(minLength: 0)
  }.frame(width: 300, height: 300).background(Color.white)
 }
}
func metrics(_ image: CGImage) -> [[String: Double]] {
 let w = image.width, h = image.height
 var pixels = [UInt8](repeating: 0, count: w*h*4)
 let ctx = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8,
  bytesPerRow: w*4, space: CGColorSpaceCreateDeviceRGB(),
  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
 ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
 return (0..<3).map { channel in
  var sum = 0.0, cy = 0.0, maxAlpha = 0.0
  var top = h, bottom = -1
  for y in 0..<h { for x in 0..<w {
   let p = (y*w+x)*4
   let other = max(Int(pixels[p+(channel+1)%3]), Int(pixels[p+(channel+2)%3]))
   let a = Double(max(0, Int(pixels[p+channel])-other))/255
   sum += a; cy += (Double(y)+0.5)*a; maxAlpha = max(maxAlpha, a)
   if a > 0.01 { top = min(top,y); bottom = max(bottom,y) }
  }}
  return ["area": sum/4, "centerY": sum > 0 ? cy/sum/2 : -1,
   "top": bottom >= 0 ? Double(top)/2 : -1,
   "bottom": Double(bottom+1)/2, "alpha": maxAlpha]
 }
}
@MainActor func run() throws {
 let out = URL(fileURLWithPath: CommandLine.arguments[1])
 _ = NSApplication.shared
 let model = Model(), host = NSHostingView(rootView: Reference(model: Model()))
 host.rootView = Reference(model: model)
 host.frame = CGRect(x: 0,y: 0,width: 300,height: 300)
 let window = NSWindow(contentRect: host.frame, styleMask: [], backing: .buffered, defer: false)
 window.contentView = host
 func snapshot() -> [[String:Double]] {
  host._renderForTest(interval: 0); host.layoutSubtreeIfNeeded(); host.displayIfNeeded()
  let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds)!
  host.cacheDisplay(in: host.bounds, to: bitmap)
  return metrics(bitmap.cgImage!)
 }
 var results: [[String:Any]] = [["mode":"initial", "time":-1, "metrics":snapshot()]]
 for (mode, value) in [("open",true),("close",false)] {
  withAnimation(.timingCurve(0.25,0.1,0.25,1,duration:0.3)) { model.filtering = value }
  for i in 0...20 {
   host._renderForTest(interval: i == 0 ? 0 : 0.02)
   results.append(["mode":mode,"time":Double(i)*0.02,"metrics":snapshot()])
  }
 }
 try JSONSerialization.data(withJSONObject: results, options:[.prettyPrinted,.sortedKeys]).write(to:out)
 print("Recorded 43 owned native samples")
}
MainActor.assumeIsolated { try! run() }
