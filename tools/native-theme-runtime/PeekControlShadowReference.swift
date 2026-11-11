import SwiftUI
import AppKit
@MainActor func main() throws {
 for (name,radius,opacity) in [("idle",4.0,0.2),("early",4.5,0.225),("mid",5.0,0.25),("late",5.5,0.275),("hover",6.0,0.3),("pressed",4.0,0.3),("lower",3.8,0.3),("upper",6.2,0.3)] {
  for width in [34.0,70.0,110.0] {
  for scale in [1.0,2.0] {
   for background in ["clear","white"] {
    let view=Capsule(style: .continuous).fill(Color.black).frame(width:width,height:34).shadow(color:.black.opacity(opacity),radius:radius,x:0,y:1).frame(width:width+60,height:94).background(background == "white" ? Color.white : Color.clear)
    let renderer=ImageRenderer(content:view)
    renderer.scale=scale
    let bitmap=NSBitmapImageRep(cgImage:renderer.cgImage!)
    try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[1]+"/native-\(name)-w\(Int(width))-\(background)-\(Int(scale))x.png"))
   }
  }
  }
 }
}
try MainActor.assumeIsolated { try main() }
