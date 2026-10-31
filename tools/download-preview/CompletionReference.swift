import SwiftUI
import AppKit

// Owned reconstruction of DownloadProgressBadge's read-only view/state trace.
// Separate diagnostic colors let the rendered pixels expose scale and opacity.
final class CompletionModel: ObservableObject { @Published var progress = 0.7 }
struct CompletionBadge: View {
 @ObservedObject var model: CompletionModel
 @State private var progressRingOpacity = 1.0
 @State private var overallOpacity = 1.0
 @State private var overallScale = 1.0
 @State private var completionScale = 1.0
 @State private var completionOpacity = 1.0
 @State private var iconName = "arrow.down"
 @State private var iconSize = 10.0
 let diagnostics: Bool
 let geometryOnly: Bool
 var body: some View {
  Group {
   if geometryOnly { Color(red:1,green:0,blue:0).frame(width:40,height:40) } else { artwork }
  }.scaleEffect(overallScale).opacity(overallOpacity)
   .onChange(of:model.progress) { if model.progress >= 1 { complete() } }
   .frame(width:40,height:40)
 }
 private var artwork: some View {
  ZStack {
   Circle().fill(diagnostics ? Color.red : Color.white).frame(width:24,height:24)
    .overlay(Circle().stroke(Color.black.opacity(0.5),lineWidth:1))
   Image(systemName:iconName).font(.system(size:iconSize,weight:.heavy))
    .foregroundColor(diagnostics ? Color.blue : Color.black)
    .animation(nil,value:iconName).animation(nil,value:iconSize)
   Group {
    ZStack {
     Circle().stroke((diagnostics ? Color.green : Color.black).opacity(0.2),lineWidth:2.5)
     Circle().trim(from:0,to:model.progress)
      .stroke(diagnostics ? Color.green : Color.black,style:StrokeStyle(lineWidth:2.5,lineCap:.round))
      .rotationEffect(.degrees(-90)).animation(.easeOut,value:model.progress)
    }.opacity(progressRingOpacity)
     .rotationEffect(.degrees(360))
     .animation(.linear(duration:1.5).repeatForever(autoreverses:false),value:model.progress)
   }.rotationEffect(.degrees(720))
    .animation(.interpolatingSpring(mass:0.1,stiffness:0.5,damping:1.2,initialVelocity:0.5).repeatForever(autoreverses:false),value:model.progress)
    .frame(width:21.5,height:21.5)
  }
 }
 private func complete() {
  withAnimation(.default) { overallScale=0.9 }
  iconName="checkmark";iconSize=9;progressRingOpacity=0.5
  withAnimation(.easeOut(duration:0.8).delay(0.15)) {
   completionScale=1.5;completionOpacity=0
  }
  withAnimation(.spring(response:0.5,dampingFraction:1,blendDuration:0).delay(0.15)) {
   overallScale=1
  }
  withAnimation(.easeOut(duration:0.15).delay(1.15)) { overallScale=1.03 }
  withAnimation(.easeIn(duration:0.15).delay(1.3)) { overallScale=0.97;overallOpacity=0 }
 }
}
func metrics(_ image:CGImage)->[String:Double] {
 let w=image.width,h=image.height
 var pixels=[UInt8](repeating:0,count:w*h*4)
 let ctx=CGContext(data:&pixels,width:w,height:h,bitsPerComponent:8,bytesPerRow:w*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
 ctx.draw(image,in:CGRect(x:0,y:0,width:w,height:h))
 var red=0.0,green=0.0,blue=0.0,maxRed=0.0,cx=0.0,cy=0.0
 for y in 0..<h {for x in 0..<w {
  let p=(y*w+x)*4
  let r=Double(max(0,Int(pixels[p])-max(Int(pixels[p+1]),Int(pixels[p+2]))))/255
  let g=Double(max(0,Int(pixels[p+1])-max(Int(pixels[p]),Int(pixels[p+2]))))/255
  let b=Double(max(0,Int(pixels[p+2])-max(Int(pixels[p]),Int(pixels[p+1]))))/255
  red+=r;green+=g;blue+=b;maxRed=max(maxRed,r);cx+=(Double(x)+0.5)*r;cy+=(Double(y)+0.5)*r
 }}
 return ["redArea":red/4,"greenArea":green/4,"blueArea":blue/4,"maxRed":maxRed,"centerX":red>0 ? cx/red/2 : -1,"centerY":red>0 ? cy/red/2 : -1]
}
@MainActor func run() throws {
 let out=URL(fileURLWithPath:CommandLine.arguments[1]);try FileManager.default.createDirectory(at:out,withIntermediateDirectories:true)
 _=NSApplication.shared
 let model=CompletionModel()
 let host=NSHostingView(rootView:CompletionBadge(model:model,diagnostics:true,geometryOnly:CommandLine.arguments.count>2).frame(width:80,height:80).background(Color.white))
 host.frame=CGRect(x:0,y:0,width:80,height:80)
 let window=NSWindow(contentRect:host.frame,styleMask:[],backing:.buffered,defer:false);window.contentView=host
 func snapshot()->CGImage {
  host._renderForTest(interval:0);host.layoutSubtreeIfNeeded();host.displayIfNeeded()
  let b=host.bitmapImageRepForCachingDisplay(in:host.bounds)!;host.cacheDisplay(in:host.bounds,to:b);return b.cgImage!
 }
 var results:[[String:Any]]=[]
 let first=snapshot();results.append(["time":-1,"metrics":metrics(first)])
 model.progress=1
 for i in 0...100 {
  host._renderForTest(interval:i==0 ? 0 : 0.02)
  let image=snapshot();results.append(["time":Double(i)*0.02,"metrics":metrics(image)])
  if [0,5,10,25,50,60,65,67,70,73,100].contains(i) {
   try NSBitmapImageRep(cgImage:image).representation(using:.png,properties:[:])!.write(to:out.appendingPathComponent("completion-\(i).png"))
  }
 }
 try JSONSerialization.data(withJSONObject:results,options:[.prettyPrinted,.sortedKeys]).write(to:out.appendingPathComponent("completion-reference.json"))
 let glyph=Image(systemName:"checkmark").font(.system(size:9,weight:.heavy)).foregroundColor(.white).frame(width:40,height:40)
 let renderer=ImageRenderer(content:glyph);renderer.scale=2
 try NSBitmapImageRep(cgImage:renderer.cgImage!).representation(using:.png,properties:[:])!.write(to:out.appendingPathComponent("checkmark-2.png"))
 print("Rendered 102 native completion samples")
}
MainActor.assumeIsolated {try! run()}
