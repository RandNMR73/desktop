import AppKit
import SwiftUI

struct HoverAXReference: View {
  @State private var count = 0
  var body: some View {
    VStack(spacing: 8) {
      Text("Primary activations: \(count)")
      HStack(spacing: 0) {
        Color.green.frame(width: 40, height: 40)
        Spacer(minLength: 0).frame(width: 12)
        VStack(alignment: .leading, spacing: 0) {
          Text("Example.png").font(.system(size: 14))
          Text("5 days ago").font(.system(size: 12))
        }.lineLimit(1)
        Spacer(minLength: 0)
        Button("Finder") { count += 100 }
      }
      .padding(4).background(Color.gray.opacity(0.1))
      .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      .contentShape(Rectangle())
      .accessibilityAddTraits(.isButton)
      .accessibilityLabel(Text("Download — Example.png"))
      .onTapGesture { count += 1 }
      .frame(width: 300, height: 56)
      Button("Reset counter") { count = 0 }
    }.padding(20).frame(width: 340, height: 180)
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 400, y: 300, width: 340, height: 180),
  styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
window.title = "Owned download row accessibility reference"
window.contentView = NSHostingView(rootView: HoverAXReference())
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
app.run()
