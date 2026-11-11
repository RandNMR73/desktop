// Offscreen SwiftUI reference for a hover/press shadow spring with new dynamics.
// swiftc PeekControlParameterSpringReference.swift -o /tmp/peek-spring; /tmp/peek-spring
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
 var results:[[String:Any]]=[]
 let hover=Animation.spring(response:0.15,dampingFraction:0.95,blendDuration:0)
 let press=Animation.spring(response:0.28,dampingFraction:0.63,blendDuration:0)
 var animation=hover, context=seed.withState(AnimationState<AnimatablePair<Double,Double>>())
 var target=AnimatablePair(2.0,0.0), finished=false, samples:[[Any]]=[]
 for ms in stride(from:0,through:700,by:5) {
  let t=Double(ms)/1000
  var merged:Bool?=nil
  if [70,95,170].contains(ms) {
   let next=ms==170 ? hover:press
   merged=next.shouldMerge(previous:animation,value:target,time:t,context:&context)
   animation=next; target=ms==95 ? AnimatablePair(2.0,0.0):AnimatablePair(0.0,0.0)
  }
  let value=finished ? nil:animation.animate(value:target,time:t,context:&context)
  if value == nil {finished=true}
  samples.append([ms,target.first,target.second,value?.first as Any? ?? NSNull(),value?.second as Any? ?? NSNull(),merged as Any? ?? NSNull()])
 }
 results.append(["name":"radius-changing-dynamics","response":0.15,"damping":0.95,"components":[2.0,0.0],"changes":[[70.0,0.28,0.63],[95.0,0.28,0.63],[170.0,0.15,0.95]],"reversal":true,"samples":samples])
 window.contentView=nil;SeedContext.box.context=nil
 FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:results,options:[.prettyPrinted,.sortedKeys]))
}
MainActor.assumeIsolated{try! main()}
