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
 let animation=Animation.interactiveSpring(response:0.15,dampingFraction:0.86,blendDuration:0.25)
 var results:[[String:Any]]=[]
 for delay in [0.0, 0.0125, 0.025, 0.0375] {
  for oldDelay in [delay, delay + 0.0125] {
   let previous=animation.delay(oldDelay);let next=animation.delay(delay)
   var context=seed.withState(AnimationState<Double>());var samples:[[String:Any]]=[]
   for ms in stride(from:0,through:400,by:5) {
    let t=Double(ms)/1000
    if ms<100 {_=previous.animate(value:20.0,time:t,context:&context)}
    if ms==100 {
     let before=state(context)
     let merged=next.shouldMerge(previous:previous,value:20.0,time:t,context:&context)
     samples.append(["merge":merged,"before":before,"state":state(context),"milliseconds":ms])
    }
    if ms>=100 {
     let value=next.animate(value:-30.0,time:t,context:&context)
     samples.append(["milliseconds":ms,"value":value as Any? ?? NSNull(),"state":state(context)])
    }
   }
   results.append(["case":"delayed-merge","delay":delay,"oldDelay":oldDelay,"samples":samples])
  }
 }
 window.contentView=nil;SeedContext.box.context=nil
 FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:results,options:[.prettyPrinted,.sortedKeys]))
}
MainActor.assumeIsolated{try! main()}
