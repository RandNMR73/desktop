// Standalone, offscreen SwiftUI reference for the texture progress animation.
// swiftc DialProgressReference.swift -o /tmp/dial-progress; /tmp/dial-progress
import SwiftUI
import AppKit
final class ContextBox { var context: AnimationContext<Double>? }
struct SeedContext: CustomAnimation {
 static let box=ContextBox()
 func animate<V>(value:V,time:TimeInterval,context:inout AnimationContext<V>)->V? where V:VectorArithmetic {
  if Self.box.context == nil {Self.box.context=context.withState(AnimationState<Double>())}
  return nil
 }
}
final class Model:ObservableObject {@Published var value=0.0}
struct SeedView:View {
 @ObservedObject var model:Model
 var body:some View {Color.blue.frame(width:20,height:20).offset(x:model.value).animation(Animation(SeedContext()),value:model.value)}
}
func state(_ context:AnimationContext<Double>)->[String:Double] {
 var result:[String:Double]=[:]
 for entry in Mirror(reflecting:context.state).children {
  for item in Mirror(reflecting:entry.value).children {
   let pair=Array(Mirror(reflecting:item.value).children)
   guard pair.count==2 else{continue}
   for field in Mirror(reflecting:pair[1].value).children {
    if let name=field.label,let value=field.value as? Double {result[name]=value}
   }
  }
 }
 return result
}
@MainActor func main() throws {
 _=NSApplication.shared;let model=Model();let host=NSHostingView(rootView:SeedView(model:model))
 host.frame=CGRect(x:0,y:0,width:100,height:100)
 let window=NSWindow(contentRect:host.frame,styleMask:[],backing:.buffered,defer:false);window.contentView=host
 host._renderForTest(interval:0);host._renderForTest(interval:0);model.value=1
 host._renderForTest(interval:0);host._renderForTest(interval:0.01)
 guard let seed=SeedContext.box.context else {fatalError("No native context")}
 let animation=Animation.default.speed(3)
 var results:[[String:Any]]=[]
 for amplitude in [0.05,0.5,1.0] {
  for reversal in [false,true] {
   var context=seed.withState(AnimationState<Double>())
   var samples:[[Any]]=[]
   var target=amplitude
   for ms in stride(from:0,through:700,by:5) {
    let t=Double(ms)/1000
    var merged:Bool?=nil
    if reversal && [30,55,120].contains(ms) {
     merged=animation.shouldMerge(previous:animation,value:target,time:t,context:&context)
     target = ms==55 ? amplitude:0
    }
    let value=animation.animate(value:target,time:t,context:&context)
    samples.append([ms,target,value as Any? ?? NSNull(),merged as Any? ?? NSNull()])
   }
   results.append(["amplitude":amplitude,"reversal":reversal,"samples":samples])
  }
 }
 window.contentView=nil;SeedContext.box.context=nil
 FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:results,options:[.prettyPrinted,.sortedKeys]))
}
MainActor.assumeIsolated{try! main()}
