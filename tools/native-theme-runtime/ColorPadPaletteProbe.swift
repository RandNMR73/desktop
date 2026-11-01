// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Build-time conversion only. Does not attach to either browser.
import AppKit

@main struct ColorPadPaletteProbe {
  enum InputError: Error { case invalidInput }
  static func main() throws {
    guard CommandLine.arguments.count == 2 else { throw InputError.invalidInput }
    let input = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    let spaces = try JSONDecoder().decode([[[Double]]].self, from: input)
    guard (1...64).contains(spaces.count) else { throw InputError.invalidInput }
    let result = try spaces.map { colors in
      guard (1...3).contains(colors.count) else { throw InputError.invalidInput }
      return try colors.map { rgba in
        guard rgba.count == 4, rgba.allSatisfy(\.isFinite),
              rgba.prefix(3).allSatisfy({ abs($0) <= 4 }), (0...1).contains(rgba[3])
        else { throw InputError.invalidInput }
        let components = rgba.map { CGFloat($0) }
        let source = NSColor(colorSpace: .extendedSRGB, components: components, count: 4)
        guard let color = source.usingColorSpace(.displayP3) else { throw InputError.invalidInput }
        return [color.redComponent, color.greenComponent, color.blueComponent]
      }
    }
    FileHandle.standardOutput.write(try JSONEncoder().encode(result))
  }
}
