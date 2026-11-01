import AppKit
import SwiftUI

// Owned reconstruction of HomeBadgingCell's traced padding/background/mask
// modifiers. Export the actual SwiftUI continuous path, not a CSS-radius guess.
struct HoverRow: View {
  var body: some View {
    HStack(spacing: 0) {
      Color.clear.frame(width: 40, height: 40)
      Spacer(minLength: 0).frame(width: 12)
      VStack(alignment: .leading, spacing: 0) {
        Text("speedometer-3-result.json").font(.system(size: 14))
        Text("5 days ago").font(.system(size: 12))
      }.lineLimit(1)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 4).padding(.vertical, 4)
    .background(Color.blue)
    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
  }
}

@MainActor func run() throws {
  _ = NSApplication.shared
  var records: [[String: Any]] = []
  for width in [180.0, 212, 214, 300, 984] {
    let renderer = ImageRenderer(content: HoverRow().frame(width: width, height: 56).background(Color.white))
    renderer.scale = 2
    let image = renderer.cgImage!
    let w = image.width, h = image.height
    var pixels = [UInt8](repeating: 0, count: w * h * 4)
    let context = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8,
      bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    var xs: [Int] = [], ys: [Int] = []
    for y in 0..<h { for x in 0..<w {
      let i = 4 * (y * w + x)
      if Int(pixels[i + 2]) - max(Int(pixels[i]), Int(pixels[i + 1])) > 128 {
        xs.append(x); ys.append(y)
      }
    }}
    var elements: [[Any]] = []
    RoundedRectangle(cornerRadius: 12, style: .continuous)
      .path(in: CGRect(x: 0, y: 0, width: width, height: 48)).forEach { element in
        switch element {
        case .move(let p): elements.append(["M", p.x, p.y])
        case .line(let p): elements.append(["L", p.x, p.y])
        case .quadCurve(let p, let c): elements.append(["Q", c.x, c.y, p.x, p.y])
        case .curve(let p, let c1, let c2): elements.append(["C", c1.x, c1.y, c2.x, c2.y, p.x, p.y])
        case .closeSubpath: elements.append(["Z"])
        }
      }
    records.append(["width": width, "outerHeight": 56, "backgroundBounds": [
      Double(xs.min()!) / 2, Double(ys.min()!) / 2,
      Double(xs.max()! - xs.min()! + 1) / 2, Double(ys.max()! - ys.min()! + 1) / 2],
      "path": elements])
  }
  FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: records, options: [.prettyPrinted, .sortedKeys]))
}
MainActor.assumeIsolated { try! run() }
