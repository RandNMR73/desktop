/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import AppKit
import SwiftUI

// Arc's CommandBar.SplashView: the color is clipped before blur, and both
// state changes share the ease-out transaction triggered by blurRadius.
private struct CommandSplash: View {
    let color: NSColor
    @State private var blurRadius: Double = 0
    @State private var opacity: Double = 1
    var body: some View {
        Color(nsColor: color)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .blur(radius: blurRadius)
            .opacity(opacity)
            .animation(.easeOut(duration: 1.2), value: blurRadius)
            .onAppear { blurRadius = 150; opacity = 0 }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

private final class CommandSplashHost: NSHostingView<CommandSplash> {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

@_cdecl("zen_command_splash_create")
public func commandSplashCreate(_ color: UnsafeRawPointer?, _ width: Double,
                               _ height: Double) -> UnsafeMutableRawPointer? {
    guard Thread.isMainThread, let color, width.isFinite, height.isFinite,
          width > 0, height > 0, width < 16384, height < 16384 else { return nil }
    let nativeColor = Unmanaged<NSColor>.fromOpaque(color).takeUnretainedValue()
    let view = CommandSplashHost(rootView: CommandSplash(color: nativeColor))
    view.frame = NSRect(x: 0, y: 0, width: width, height: height)
    view.setAccessibilityHidden(true)
    return Unmanaged.passRetained(view).toOpaque()
}
