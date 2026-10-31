import AppKit
import SwiftUI

final class IconSamples {
  var y = 0.0, scale = 1.0
  var action: ((String) -> Void)?
}
struct ReadIconValue: AnimatableModifier {
  var value: Double
  let isScale: Bool
  let samples: IconSamples
  var animatableData: Double { get { value } set { value = newValue } }
  @ViewBuilder func body(content: Content) -> some View {
    if isScale {
      let _ = { samples.scale = value }()
      content.scaleEffect(value)
    } else {
      let _ = { samples.y = value }()
      content.offset(y: value)
    }
  }
}
struct IconTrajectory: View {
  let samples: IconSamples
  @State private var y = 0.0
  @State private var scale = 1.0
  var body: some View {
    Color.blue.frame(width: 20, height: 20)
      .modifier(ReadIconValue(value: scale, isScale: true, samples: samples))
      .modifier(ReadIconValue(value: y, isScale: false, samples: samples))
      .frame(width: 200, height: 200)
      .onAppear {
        samples.action = { action in
          switch action {
          case "arrival":
            y = 0; scale = 1
            withAnimation(.timingCurve(0.78, 0, 0.7, 1, duration: 0.2)) { y = 6 }
          case "return":
            withAnimation(.interpolatingSpring(mass: 1, stiffness: 500,
                           damping: 25, initialVelocity: 10)) { y = 0 }
          case "dismissal": scale = 1
          case "grow": withAnimation(.linear(duration: 0.1)) { scale = 1.2 }
          case "shrink": withAnimation(.linear(duration: 0.1)) { scale = 1 }
          case "reset": y = 0; scale = 1
          default: fatalError(action)
          }
        }
      }
  }
}
@MainActor func run(_ name: String, _ events: [(Int, String)]) -> [String: Any] {
  let samples = IconSamples()
  let host = NSHostingView(rootView: IconTrajectory(samples: samples))
  host.frame = CGRect(x: 0, y: 0, width: 200, height: 200)
  let window = NSWindow(contentRect: host.frame, styleMask: [], backing: .buffered, defer: false)
  window.contentView = host
  host._renderForTest(interval: 0); host._renderForTest(interval: 0)
  var result: [[String: Any]] = []
  for milliseconds in stride(from: 0, through: 1250, by: 5) {
    if milliseconds > 0 { host._renderForTest(interval: 0.005) }
    for event in events where event.0 == milliseconds {
      samples.action!(event.1); host._renderForTest(interval: 0)
      // Start the newly installed animation without adding a whole 5ms sample
      // interval to its clock. The accumulated epsilon is below 0.01ms.
      host._renderForTest(interval: 0.000001)
    }
    host.layoutSubtreeIfNeeded(); host.displayIfNeeded()
    result.append(["milliseconds": milliseconds, "y": samples.y, "scale": samples.scale])
  }
  samples.action = nil; window.contentView = nil
  return ["case": name, "events": events.map { ["milliseconds": $0.0, "action": $0.1] }, "samples": result]
}
@MainActor func main() throws {
  _ = NSApplication.shared
  let result = [
    run("arrival", [(0, "arrival"), (220, "return")]),
    run("arrival-arrival", [(0, "arrival"), (100, "arrival"), (220, "return"), (320, "return")]),
    run("arrival-dismissal", [(0, "arrival"), (100, "dismissal"), (220, "return"), (260, "grow"), (370, "shrink")]),
    run("dismissal-arrival", [(0, "dismissal"), (100, "arrival"), (160, "grow"), (270, "shrink"), (320, "return")]),
    run("arrival-reset", [(0, "arrival"), (100, "reset"), (220, "return")]),
    run("dismissal-reset", [(0, "dismissal"), (100, "reset"), (160, "grow"), (270, "shrink")]),
    run("dismissal-arrival-arrival", [(0, "dismissal"), (100, "arrival"), (160, "grow"),
      (200, "arrival"), (270, "shrink"), (320, "return"), (420, "return")]),
    run("dismissal-dismissal", [(0, "dismissal"), (100, "dismissal"), (160, "grow"),
      (260, "grow"), (270, "shrink"), (370, "shrink")]),
    run("arrival-reset-arrival", [(0, "arrival"), (100, "reset"), (150, "arrival"),
      (220, "return"), (370, "return")]),
    run("arrival-during-spring", [(0, "arrival"), (220, "return"), (260, "arrival"), (480, "return")]),
    run("arrival-late-during-spring", [(0, "arrival"), (220, "return"), (400, "arrival"), (620, "return")]),
    run("three-arrivals-during-spring", [(0, "arrival"), (220, "return"), (260, "arrival"),
      (400, "arrival"), (480, "return"), (620, "return")])
  ]
  FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result,
    options: [.prettyPrinted, .sortedKeys]))
}
MainActor.assumeIsolated { try! main() }
