import SwiftUI
import Foundation
let spring = Spring(response: 0.15, dampingRatio: 0.86)
let report: [String: Any] = [
  "response": spring.response, "dampingRatio": spring.dampingRatio,
  "mass": spring.mass, "stiffness": spring.stiffness, "damping": spring.damping,
  "settlingDuration": spring.settlingDuration,
  "animation": String(reflecting: Animation.interactiveSpring(response: 0.15, dampingFraction: 0.86, blendDuration: 0.25)),
  "samples": [0.0, -10.0, 10.0].map { velocity in
    ["initialVelocity": velocity, "values": (0...600).map { i in
      let t = Double(i) / 2000.0
      return ["time": t, "value": spring.value(target: 1.0, initialVelocity: velocity, time: t), "velocity": spring.velocity(target: 1.0, initialVelocity: velocity, time: t)]
    }] as [String: Any]
  }
]
let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
