import SwiftUI
import AppKit
struct Row: View {
 let progress:Double, initialScale:Double
 var body:some View {
  Color.white.frame(width:320,height:320).overlay(alignment:.bottomLeading) {
   Color.clear.frame(width:32,height:32).overlay(alignment:.bottomLeading) {
    VStack(alignment:.leading,spacing:0) {
     Color(red:1,green:0,blue:0).frame(width:40,height:40).padding(4)
      .frame(width:40,height:56)
      .scaleEffect(initialScale+(0.2-initialScale)*progress)
      .rotationEffect(.degrees(-45*progress))
      .offset(x:10-14*progress,y:30+20*progress)
      // Keep the shape opaque to isolate geometry from color-space blending.
      .opacity(1)
    }.offset(x:-4,y:-30)
   }.padding(.leading,8).padding(.bottom,8)
  }
 }
}
@MainActor func run() throws {
 _ = NSApplication.shared
 var output:[[String:Double]]=[]
 for scale in [0.55,0.8] { for i in 0...9 {
  let p=Double(i)/10
  let host=NSHostingView(rootView:Row(progress:p,initialScale:scale));host.frame=CGRect(x:0,y:0,width:320,height:320)
  let window=NSWindow(contentRect:host.frame,styleMask:[],backing:.buffered,defer:false);window.contentView=host
  host.layoutSubtreeIfNeeded();host.displayIfNeeded()
  let bitmap=host.bitmapImageRepForCachingDisplay(in:host.bounds)!;host.cacheDisplay(in:host.bounds,to:bitmap)
  let image=bitmap.cgImage!, w=image.width,h=image.height
  var pixels=[UInt8](repeating:0,count:w*h*4)
  let context=CGContext(data:&pixels,width:w,height:h,bitsPerComponent:8,bytesPerRow:w*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.draw(image,in:CGRect(x:0,y:0,width:w,height:h))
  var total=0.0,xsum=0.0,ysum=0.0
  for y in 0..<h { for x in 0..<w {
   let n=(y*w+x)*4, weight=Double(Int(pixels[n])-Int(pixels[n+1]))/255
   if weight>0 {total+=weight;xsum+=(Double(x)+0.5)*weight;ysum+=(Double(y)+0.5)*weight}
  }}
  output.append(["progress":p,"initialScale":scale,"x":xsum/total/2,"y":ysum/total/2,"area":total/4])
  window.contentView=nil
 }}
 FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:output,options:[.prettyPrinted,.sortedKeys]))
}
MainActor.assumeIsolated {try! run()}
