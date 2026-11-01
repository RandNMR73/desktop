import AppKit
import SwiftUI

// Owned four-row reconstruction, using real SwiftUI modifiers and persistent
// ForEach identities. Only the chosen row draws three colored markers; their
// rendered centroids recover its center, scale and rotation without depending
// on native glyph rasterization or opacity color-space conversion.
final class Scheduler {
  var now = 0
  var queue: [(Int, () -> Void)] = []
  func after(_ milliseconds: Int, _ action: @escaping () -> Void) {
    queue.append((now + milliseconds, action))
    queue.sort { $0.0 < $1.0 }
  }
  func flush() {
    while let first = queue.first, first.0 <= now {
      queue.removeFirst(); first.1()
    }
  }
}
final class ThumbnailModel: ObservableObject {
  @Published var selected: String?
  @Published var expanded = false
  @Published var items = ["A", "B", "C", "D"]
  let active: Set<String>
  let scheduler = Scheduler()
  var read: (() -> [String: Any])?
  var events: [[String: Any]] = []
  init(initial: String?, active: Set<String>) { selected = initial; self.active = active }
}
struct SelectionKey: Equatable { let id: String?; let index: Int? }
struct ThumbnailMarkers: View {
  let shown: Bool
  var body: some View {
    ZStack(alignment: .topLeading) {
      Color.clear
      if shown {
        Color(red: 1, green: 0, blue: 0).frame(width: 8, height: 8).offset(x: 6, y: 6)
        Color(red: 0, green: 1, blue: 0).frame(width: 8, height: 8).offset(x: 26, y: 6)
        Color(red: 0, green: 0, blue: 1).frame(width: 8, height: 8).offset(x: 6, y: 26)
      }
    }.frame(width: 40, height: 40)
  }
}
struct ThumbnailCell: View {
  let details: Bool
  let shown: Bool
  var body: some View {
    HStack(spacing: 0) {
      ThumbnailMarkers(shown: shown)
      if details { Color.clear.frame(width: 12); Color.clear.frame(height: 32); Spacer(minLength: 0) }
    }.padding(.horizontal, 4).padding(.vertical, 4)
  }
}
struct ThumbnailStack: View {
  @ObservedObject var model: ThumbnailModel
  let inspected: String
  @State private var visible: String?
  @State private var x = 0.0
  @State private var y = 0.0
  @State private var opacity = 0.0
  @State private var scale = 1.0
  @State private var rotation = 0.0
  var selection: SelectionKey {
    SelectionKey(id: model.selected, index: model.selected.flatMap { model.items.firstIndex(of: $0) })
  }
  func rest() -> (Double, Double) {
    guard !model.expanded, let id = visible, let index = model.items.firstIndex(of: id) else { return (0, 0) }
    return (10, 30 + 56 * Double(index))
  }
  func closedScale() -> Double { model.active.contains(visible ?? "") ? 0.8 : 0.55 }
  func state() -> [String: Any] {
    ["selected": model.selected as Any? ?? NSNull(), "visible": visible as Any? ?? NSNull(),
     "expanded": model.expanded, "x": x, "y": y, "scale": scale,
     "opacity": opacity, "rotation": rotation]
  }
  func record(_ event: String) { model.events.append(["milliseconds": model.scheduler.now, "event": event, "state": state()]) }
  func reset() {
    let position = rest(); x = position.0; y = position.1
    scale = closedScale(); rotation = 0
    opacity = model.expanded || visible != nil ? 1 : 0
  }
  func arrive() {
    guard !model.expanded else { reset(); return }
    let position = rest()
    x = position.0; y = position.1 - 8; opacity = 0; scale = closedScale()
    withAnimation(.timingCurve(0.78, 0, 0.7, 1, duration: 0.2)) { y = position.1 + 12; opacity = 1 }
    record("arrival")
    model.scheduler.after(220) {
      withAnimation(.interpolatingSpring(mass: 1, stiffness: 500, damping: 25, initialVelocity: 10)) { y = position.1 }
      record("arrival-return")
    }
  }
  func dismiss() {
    guard !model.expanded else { visible = nil; record("expanded-clear"); return }
    let position = rest()
    withAnimation(.linear(duration: 0.14)) {
      x = position.0 - 14; y = position.1 + 20; opacity = 0; scale = 0.2; rotation = -45
    }
    record("dismissal")
    // Icon pulse callbacks do not write thumbnail state. The native cleanup
    // after 160 + 110 + 120ms reads the current shared selected identity.
    model.scheduler.after(390) {
      x = position.0; y = position.1; scale = 1; rotation = 0; visible = model.selected
      record("dismissal-cleanup")
    }
  }
  func offset(_ id: String, _ index: Int) -> CGSize {
    if model.expanded { return .zero }
    if id != visible { return CGSize(width: 0, height: index == 0 ? 20 : 56) }
    let position = x == 0 && y == 0 ? rest() : (x, y)
    return CGSize(width: position.0, height: position.1)
  }
  var body: some View {
    Color.white.frame(width: 320, height: 320).overlay(alignment: .bottomLeading) {
      Color.clear.frame(width: 32, height: 32).overlay(alignment: .bottomLeading) {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(model.items.reversed()), id: \.self) { id in
            let selected = id == visible
            let index = model.items.firstIndex(of: id)!
            ThumbnailCell(details: model.expanded || !selected, shown: id == inspected)
              .frame(width: !model.expanded && selected ? 40 : 212, height: 56)
              .scaleEffect(!model.expanded && selected ? (scale == 1 ? closedScale() : scale) : 1)
              .rotationEffect(.degrees(!model.expanded && selected ? rotation : 0))
              .offset(offset(id, index))
              .opacity(model.expanded ? 1 : selected ? opacity : 0)
              .animation(.interactiveSpring(response: 0.15, dampingFraction: 0.86, blendDuration: 0.25)
                .delay(Double(index) * 0.0125), value: model.expanded)
          }
        }.offset(x: -4, y: -30)
      }.padding(.leading, 8).padding(.bottom, 8)
    }
    .onAppear { visible = model.selected; reset(); model.read = { state() }; record("mounted") }
    .onChange(of: selection) { _, next in
      if next.id == visible { let position = rest(); x = position.0; y = position.1; record("same-id"); return }
      if let id = next.id { visible = id; arrive() } else { dismiss() }
    }
    .onChange(of: model.expanded) { _, expanded in
      reset(); record("expansion-reset")
      if expanded, let selected = model.selected, !model.active.contains(selected) { model.selected = nil }
    }
  }
}

func markers(_ image: CGImage) -> [String: Any] {
  let w = image.width, h = image.height
  var pixels = [UInt8](repeating: 0, count: w * h * 4)
  let context = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
  var areas = [Double](repeating: 0, count: 3), xs = areas, ys = areas
  for y in 0..<h { for x in 0..<w {
    let p = (y * w + x) * 4
    let r = Int(pixels[p]), g = Int(pixels[p + 1]), b = Int(pixels[p + 2])
    let values = [max(0, r - max(g, b)), max(0, g - max(r, b)), max(0, b - max(r, g))]
    for i in 0..<3 {
      let weight = Double(values[i]) / 255
      areas[i] += weight; xs[i] += (Double(x) + 0.5) * weight; ys[i] += (Double(y) + 0.5) * weight
    }
  }}
  guard areas.allSatisfy({ $0 > 0.5 }) else { return ["visible": false, "areas": areas] }
  let scaleFactor = Double(w) / 320
  for i in 0..<3 { xs[i] /= areas[i] * scaleFactor; ys[i] /= areas[i] * scaleFactor }
  let dx = xs[1] - xs[0], dy = ys[1] - ys[0]
  return ["visible": true, "centerX": (xs[1] + xs[2]) / 2, "centerY": (ys[1] + ys[2]) / 2,
    "scale": hypot(dx, dy) / 20, "rotation": atan2(dy, dx) * 180 / .pi,
    "areas": areas.map { $0 / (scaleFactor * scaleFactor) }]
}
struct Input { let time: Int; let name: String; let run: (ThumbnailModel) -> Void }
@MainActor func runCase(_ name: String, initial: String?, active: Set<String>, inspected: String,
                        inputs: [Input], output: URL) throws -> [String: Any] {
  let model = ThumbnailModel(initial: initial, active: active)
  let host = NSHostingView(rootView: ThumbnailStack(model: model, inspected: inspected))
  host.frame = CGRect(x: 0, y: 0, width: 320, height: 320)
  let window = NSWindow(contentRect: host.frame, styleMask: [], backing: .buffered, defer: false)
  window.contentView = host
  host._renderForTest(interval: 0); host._renderForTest(interval: 0)
  var result: [[String: Any]] = []
  for time in stride(from: 0, through: 1200, by: 10) {
    if time > 0 { host._renderForTest(interval: 0.01) }
    model.scheduler.now = time
    for input in inputs where input.time == time { input.run(model) }
    model.scheduler.flush()
    host._renderForTest(interval: 0); host._renderForTest(interval: 0.000001)
    if time % 20 == 0 || inputs.contains(where: { $0.time == time }) || time == 390 {
      host.layoutSubtreeIfNeeded(); host.displayIfNeeded()
      let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds)!
      host.cacheDisplay(in: host.bounds, to: bitmap)
      result.append(["milliseconds": time, "geometry": markers(bitmap.cgImage!), "state": model.read?() ?? [:]])
      if [0, 100, 140, 200, 260, 390, 600].contains(time) {
        let file = output.appendingPathComponent("\(name)-\(inspected)-\(time).png")
        try bitmap.representation(using: .png, properties: [:])!.write(to: file)
      }
    }
  }
  model.read = nil; model.scheduler.queue.removeAll(); window.contentView = nil
  return ["case": name, "inspected": inspected, "initial": initial as Any? ?? NSNull(),
    "active": Array(active).sorted(), "inputs": inputs.map { ["milliseconds": $0.time, "name": $0.name] },
    "events": model.events, "samples": result]
}
@MainActor func main() throws {
  _ = NSApplication.shared
  let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
  try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
  func select(_ t: Int, _ id: String?, reorder: Bool = false) -> Input {
    Input(time: t, name: "select-" + (id ?? "nil"), run: { model in
      if reorder, let id { model.items = [id] + model.items.filter { $0 != id } }
      model.selected = id
    })
  }
  func expand(_ t: Int, _ value: Bool) -> Input {
    Input(time: t, name: value ? "expand" : "collapse", run: { $0.expanded = value })
  }
  var results: [[String: Any]] = []
  let cases: [(String, String?, Set<String>, [String], [Input])] = [
    ("expand-reorder-collapse", "A", ["A","B"], ["A","B"], [expand(0,true),select(40,"B",reorder:true),expand(80,false)]),
    ("expand-reorder-twice-collapse", "A", ["A","B","C"], ["A","B","C"], [expand(0,true),select(40,"B",reorder:true),select(60,"C",reorder:true),expand(80,false)]),
    ("arrival-expand-reorder-collapse", nil, ["A","B"], ["A","B"], [select(0,"A"),expand(100,true),select(140,"B",reorder:true),expand(180,false)]),
    ("settled-expand-arrival-collapse", nil, ["B"], ["A","B"], [expand(0,true),select(400,"B",reorder:true),expand(440,false)])
  ]
  for c in cases { for item in c.3 {
    results.append(try runCase(c.0, initial: c.1, active: c.2, inspected: item, inputs: c.4, output: output))
  }}
  FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: results, options: [.prettyPrinted, .sortedKeys]))
}
MainActor.assumeIsolated { try! main() }
