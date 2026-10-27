// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Standalone diagnostic. This does not load into or modify either browser.
import AppKit
import SwiftUI

struct PaletteInput: Decodable {
  struct Space: Decodable {
    let name: String
    // Extended-sRGB RGBA, before the notification-specific transformation.
    let base: [[Double]]
  }
  let spaces: [Space]
}

struct PaletteOutput: Encodable {
  let name: String
  let transformedBase: [[Double]]
  let average: [Double]
  let darkHighlight: Bool
  let whiteForeground: Bool
}

enum InputError: Error { case invalidColors, missingInput }

func hsl(_ color: NSColor) -> (Double, Double, Double) {
  let color = NSColor(cgColor: color.cgColor) ?? color
  let r = color.redComponent, g = color.greenComponent, b = color.blueComponent
  let hi = max(r, g, b), lo = min(r, g, b), delta = hi - lo
  let lightness = (hi + lo) / 2
  guard delta != 0 else { return (0, 0, lightness) }
  let saturation = delta / (lightness > 0.5 ? 2 - hi - lo : hi + lo)
  let hue: Double
  if hi == r { hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6 }
  else if hi == g { hue = ((b - r) / delta + 2) / 6 }
  else { hue = ((r - g) / delta + 4) / 6 }
  return (hue, saturation, lightness)
}

func hueComponent(_ p: Double, _ q: Double, _ input: Double) -> Double {
  let t = input < 0 ? input + 1 : input > 1 ? input - 1 : input
  if t < 1 / 6 { return p + (q - p) * 6 * t }
  if t < 0.5 { return q }
  if t < 2 / 3 { return p + (q - p) * (2 / 3 - t) * 6 }
  return p
}

func transform(_ rgba: [Double]) -> [Double] {
  // colorWithRed preserves extended components. The explicitly sRGB-named
  // initializer clips negative components before conversion to Display P3.
  let source = NSColor(red: rgba[0], green: rgba[1], blue: rgba[2], alpha: rgba[3])
  let color = source.usingColorSpace(.displayP3) ?? source
  let (h, s, l) = hsl(color)
  let ds = s < 0.1 ? 0 : s < 0.3 ? 0.4 : s < 0.7 ? 0.2 : 0
  let dl = l < 0.1 ? (s < 0.2 ? 0.3 : 0.15)
    : (l < 0.45 || l > 0.95) ? -0.05 : l < 0.8 ? 0.1 : -0.125
  let saturation = min(1, max(0, s + ds)), lightness = min(1, max(0, l + dl))
  let q = lightness < 0.5 ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation
  let p = 2 * lightness - q
  return [hueComponent(p, q, h + 1 / 3), hueComponent(p, q, h),
          hueComponent(p, q, h - 1 / 3), color.alphaComponent].map { min(1, max(0, $0)) }
}

func palette(_ space: PaletteInput.Space) throws -> PaletteOutput {
  guard !space.base.isEmpty, space.base.count <= 64,
        space.base.allSatisfy({ $0.count == 4 && $0.allSatisfy(\.isFinite)
          && (0...1).contains($0[3]) && $0.prefix(3).allSatisfy({ abs($0) <= 16 }) })
  else { throw InputError.invalidColors }
  let colors = space.base.map(transform)
  let average = (0..<4).map { channel in
    colors.reduce(0) { $0 + $1[channel] } / Double(colors.count)
  }
  // The transformed P3 component numbers are intentionally interpreted as sRGB
  // here. A second P3-to-sRGB conversion would change the observed algorithm.
  let averageColor = NSColor(srgbRed: average[0], green: average[1],
                            blue: average[2], alpha: average[3])
  let dark = hsl(averageColor.usingColorSpace(.displayP3) ?? averageColor).2 < 0.45
  let foregroundBase = averageColor.blended(withFraction: 0.3, of: dark ? .black : .white)
    ?? averageColor
  let white = hsl(foregroundBase.usingColorSpace(.displayP3) ?? foregroundBase).2 < 0.45
  return PaletteOutput(name: space.name, transformedBase: colors, average: average,
                       darkHighlight: dark, whiteForeground: white)
}

struct ToastMaterial: NSViewRepresentable {
  func makeNSView(context: Context) -> NSVisualEffectView {
    let view = NSVisualEffectView()
    // Raw value 1 is the deprecated Light material used by the reference app.
    // A semantic substitute produces a different underlay.
    view.material = NSVisualEffectView.Material(rawValue: 1)!
    view.blendingMode = .withinWindow
    view.state = .active
    view.isEmphasized = false
    return view
  }
  func updateNSView(_ view: NSVisualEffectView, context: Context) {}
}

struct PaletteView: View {
  let palettes: [PaletteOutput]
  var body: some View {
    VStack(spacing: 16) {
      ForEach(palettes.indices, id: \.self) { i in
        let palette = palettes[i]
        let c = palette.average
        let shade: Color = palette.darkHighlight ? .black : .white
        HStack(spacing: 20) {
          Text(palette.name).frame(width: 100, alignment: .leading).foregroundStyle(.white)
          ZStack {
            ToastMaterial()
            RoundedRectangle(cornerRadius: 12, style: .continuous)
              .fill(Color(nsColor: NSColor(srgbRed: c[0], green: c[1], blue: c[2], alpha: c[3])).opacity(0.8))
            RoundedRectangle(cornerRadius: 12, style: .continuous).fill(
              LinearGradient(colors: [shade.opacity(palette.darkHighlight ? 0.2 : 0.4),
                                      shade.opacity(palette.darkHighlight ? 0.4 : 0.2)],
                             startPoint: .top, endPoint: .bottom))
            Text("Copied Current URL")
              .foregroundStyle(palette.whiteForeground ? .white : .black)
              .font(.system(size: 14, weight: .medium))
          }.frame(width: 196, height: 47)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
      }
    }.padding(24).frame(width: 420).background(.black)
  }
}

final class ProbeDelegate: NSObject, NSApplicationDelegate {
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main struct Main {
  @MainActor static func main() {
    do { try run() }
    catch {
      FileHandle.standardError.write(Data("Palette probe failed: \(error)\n".utf8))
      exit(1)
    }
  }

  @MainActor static func run() throws {
    let dump = CommandLine.arguments.dropFirst().first == "--dump-colors"
    let path: String
    if dump, CommandLine.arguments.count == 3 { path = CommandLine.arguments[2] }
    else if !dump, let resource = Bundle.main.path(forResource: "palettes", ofType: "json") {
      path = resource
    } else { throw InputError.missingInput }
    let input = try JSONDecoder().decode(PaletteInput.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
    guard !input.spaces.isEmpty, input.spaces.count <= 12 else { throw InputError.invalidColors }
    let palettes = try input.spaces.map(palette)
    if dump {
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
      FileHandle.standardOutput.write(try encoder.encode(palettes))
      FileHandle.standardOutput.write(Data("\n".utf8))
      return
    }
    let app = NSApplication.shared
    let delegate = ProbeDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    let menu = NSMenu(), item = NSMenuItem(), application = NSMenu()
    application.addItem(withTitle: "Quit Palette Probe", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    item.submenu = application
    menu.addItem(item)
    app.mainMenu = menu
    let view = PaletteView(palettes: palettes)
    let window = NSWindow(contentRect: NSRect(x: 400, y: 400, width: 420,
                           height: 32 + palettes.count * 63),
                          styleMask: [.titled, .closable], backing: .buffered, defer: false)
    window.title = "Read-only palette comparison"
    window.contentView = NSHostingView(rootView: view)
    window.makeKeyAndOrderFront(nil)
    withExtendedLifetime((window, delegate)) { app.run() }
  }
}
