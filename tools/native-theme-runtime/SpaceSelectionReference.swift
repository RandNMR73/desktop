import Foundation
import Motion

// Arc's PageSwipeController selection setter ignores the same destination.
// A changed destination calls settle with nil velocity, which writes zero.
var cases: [[String: Any]] = []
for width in [180.0, 228.0, 340.0] {
    for fps in [60.0, 120.0] {
        for elapsed in [0.05, 0.2] {
            for target in [0.0, 1.0, 2.0] {
                let spring = SpringAnimation<Double>(initialValue: 0, response: 0.4, dampingRatio: 1)
                spring.toValue = width
                for _ in 0..<Int((elapsed * fps).rounded()) {
                    spring.tick(frame: AnimationFrame(1 / fps))
                }
                let position = spring.value / width
                let velocity = spring.velocity / width
                if target != 1 {
                    spring.toValue = target * width
                    spring.velocity = 0
                }
                var samples: [[Double]] = []
                for frame in 0...240 {
                    if frame > 0 { spring.tick(frame: AnimationFrame(1 / fps)) }
                    samples.append([Double(frame) / fps, spring.value / width])
                    if spring.hasResolved() { break }
                }
                cases.append(["width": width, "fps": fps, "elapsed": elapsed,
                              "position": position, "velocity": velocity,
                              "previousTarget": 1.0, "target": target, "samples": samples])
            }
        }
    }
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: cases, options: [.prettyPrinted, .sortedKeys]))
