import SwiftUI
import Foundation
let spring = Spring(mass: 1, stiffness: 500, damping: 25)
let report: [String: Any] = [
 "mass": spring.mass, "stiffness": spring.stiffness, "damping": spring.damping,
 "settlingDuration": spring.settlingDuration,
 "animation": String(reflecting: Animation.interpolatingSpring(mass: 1, stiffness: 500, damping: 25, initialVelocity: 10)),
 "samples": (0...1200).map { i in
  let t = Double(i)/2000
  return ["time": t, "value": spring.value(target: 1.0, initialVelocity: 10, time: t), "velocity": spring.velocity(target: 1.0, initialVelocity: 10, time: t)]
 }
]
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]))
