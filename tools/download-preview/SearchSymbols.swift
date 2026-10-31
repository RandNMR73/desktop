import AppKit
import SwiftUI

// PageHeaderView uses resizable system symbols, with no font-weight override.
// Render in an owned process; the reference browser is never instrumented.
@MainActor func exportSymbols() throws {
  _ = NSApplication.shared
  let out = URL(fileURLWithPath: CommandLine.arguments[1])
  let symbols: [(String, String, CGFloat)] = [
    ("search-magnifyingglass", "magnifyingglass", 15),
    ("search-filter", "line.3.horizontal.decrease.circle", 15),
    ("search-remove", "xmark.circle.fill", 14),
  ]
  for (name, symbol, size) in symbols {
    let view = Image(systemName: symbol).resizable()
      .frame(width: size, height: size).foregroundColor(.white)
    let renderer = ImageRenderer(content: view)
    renderer.scale = 2
    let data = NSBitmapImageRep(cgImage: renderer.cgImage!)
      .representation(using: .png, properties: [:])!
    let svg = """
    <svg xmlns="http://www.w3.org/2000/svg" width="\(Int(size))" height="\(Int(size))" viewBox="0 0 \(Int(size)) \(Int(size))">
    <!-- SwiftUI \(symbol), resizable, \(Int(size))pt; native 2x alpha mask. -->
    <defs><mask id="glyph"><image width="\(Int(size))" height="\(Int(size))" href="data:image/png;base64,\(data.base64EncodedString())"/></mask></defs>
    <rect width="100%" height="100%" fill="context-fill" mask="url(#glyph)"/>
    </svg>

    """
    try svg.write(to: out.appendingPathComponent(name + ".svg"), atomically: true, encoding: .utf8)
  }
}
MainActor.assumeIsolated { try! exportSymbols() }
