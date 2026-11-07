import Foundation
import Motion
var cases:[[String:Any]]=[]
for width in [180.0,228.0,340.0] {
 for distance in [0.001,0.35,1.0,2.0] {
  for fps in [60.0,120.0] {
   let spring=SpringAnimation<Double>(initialValue:0,response:0.4,dampingRatio:1)
   spring.toValue=width*distance
   var samples:[[Double]]=[]
   for frame in 0...240 {
    if frame>0 {spring.tick(frame:AnimationFrame(1/fps))}
    samples.append([Double(frame)/fps,spring.value/width,spring.velocity/width])
    if spring.hasResolved() {break}
   }
   cases.append(["width":width,"distance":distance,"fps":fps,"epsilon":spring.resolvingEpsilon,"samples":samples])
  }
 }
}
let data=try JSONSerialization.data(withJSONObject:cases,options:[.prettyPrinted,.sortedKeys])
FileHandle.standardOutput.write(data)
