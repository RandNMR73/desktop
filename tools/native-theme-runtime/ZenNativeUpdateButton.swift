/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import AppKit
import SwiftUI

// Keep the extended-sRGB input until Core Animation composites the material.
// Painting its layers separately in Gecko clips the negative channels before
// hard-light blending, especially in red and green Spaces.
private struct UpdateButton: View {
    let color: NSColor
    let label: String
    let size: CGSize
    let dark: Bool
    let pressed: Bool
    let disabled: Bool
    let animate: Bool
    @State private var lightAngle = 0.0
    @State private var shadeAngle = 0.0

    var body: some View {
        let color = Color(nsColor: color)
        let scale = size.height / 24
        let shape = RoundedRectangle(cornerRadius: (pressed ? 7 : 6) * scale, style: .continuous)
        ZStack {
            color
            ZStack {
                Capsule(style: .continuous)
                    .frame(width: size.width / 1.5, height: size.height).scaleEffect(2)
                    .rotationEffect(.degrees(lightAngle)).foregroundStyle(color)
                    .hueRotation(.degrees(40)).saturation(5).brightness(1.25)
                    .offset(y: -size.height / 2).blur(radius: 24 * scale).blendMode(.hardLight)
                Capsule(style: .continuous)
                    .frame(width: size.width / 2, height: size.height).scaleEffect(2)
                    .rotationEffect(.degrees(shadeAngle)).foregroundStyle(color.opacity(0.6))
                    .hueRotation(.degrees(-20)).saturation(2).brightness(-0.5)
                    .offset(y: -size.height / 1.75).blur(radius: 12 * scale).blendMode(.hardLight)
            }.opacity(0.5)
            Text(verbatim: label).font(.system(size: 12 * scale))
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.2), radius: scale, x: scale, y: scale)
                .opacity(pressed ? 0.8 : 1)
        }
        .frame(width: size.width, height: size.height).clipShape(shape)
        .overlay { shape.strokeBorder(.white.opacity(dark ? 0.2 : 0), lineWidth: scale) }
        .opacity(disabled ? 0.65 : 1)
        .allowsHitTesting(false).accessibilityHidden(true)
        .onAppear { startAnimation() }
        .onChange(of: animate) { startAnimation() }
    }

    private func startAnimation() {
        withAnimation(nil) { lightAngle = 0; shadeAngle = 0 }
        if animate {
            withAnimation(.linear(duration: 8).repeatForever(autoreverses: false)) { lightAngle = -360 }
            withAnimation(.linear(duration: 20).repeatForever(autoreverses: false)) { shadeAngle = 360 }
        }
    }
}

private final class UpdateButtonHost: NSHostingView<UpdateButton> {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

private final class UpdateButtonClip: NSView {
    var lastRequest = ""
    let host: UpdateButtonHost
    init(_ content: UpdateButton) {
        host = UpdateButtonHost(rootView: content)
        super.init(frame: .zero)
        wantsLayer = true
        layer?.masksToBounds = true
        setAccessibilityHidden(true)
        host.setAccessibilityHidden(true)
        addSubview(host)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

private enum UpdateButtons {
    // Neither a native view nor this map retains a browser window.
    static let views = NSMapTable<NSWindow, UpdateButtonClip>.weakToStrongObjects()
    static func window(_ handle: UInt64) -> NSWindow? {
        NSApp.windows.first { UInt64(UInt(bitPattern: Unmanaged.passUnretained($0).toOpaque())) == handle }
    }
    static func clear(_ window: NSWindow) {
        views.object(forKey: window)?.removeFromSuperview()
        views.removeObject(forKey: window)
    }
}

@_cdecl("zen_update_button_version")
public func updateButtonVersion() -> Int32 { 1 }

@_cdecl("zen_update_button_clear")
public func updateButtonClear(_ handle: UInt64) -> Int32 {
    guard Thread.isMainThread else { return 1 }
    guard let window = UpdateButtons.window(handle) else { return 2 }
    UpdateButtons.clear(window)
    return 0
}

// Decoration only: hit testing, focus, accessible label, checkbox and restart
// action remain in Gecko. The bounded request carries no browsing information.
@_cdecl("zen_update_button_sync")
public func updateButtonSync(_ handle: UInt64, _ json: UnsafePointer<CChar>?) -> Int32 {
    guard Thread.isMainThread else { return 1 }
    guard let window = UpdateButtons.window(handle) else { return 2 }
    func fail() -> Int32 { UpdateButtons.clear(window); return 3 }
    guard let json, strnlen(json, 4097) <= 4096,
          let text = String(validatingCString: json), let data = text.data(using: .utf8),
          let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let rect = request["rect"] as? [Double], rect.count == 4,
          let clip = request["clip"] as? [Double], clip.count == 4,
          let viewport = request["viewport"] as? [Double], viewport.count == 2,
          (rect + clip + viewport).allSatisfy({ $0.isFinite && abs($0) <= 16384 }),
          rect[2] > 0, rect[2] <= 1024, rect[3] > 0, rect[3] <= 128,
          clip[0] >= 0, clip[1] >= 0, clip[2] > 0, clip[3] > 0, viewport.allSatisfy({ $0 > 0 }),
          let rgba = request["rgba"] as? [Double], rgba.count == 4,
          rgba.allSatisfy({ $0.isFinite && abs($0) <= 4 }), rgba[3] == 1,
          let p3 = request["p3"] as? Bool,
          let label = request["label"] as? String,
          ["Restart and Update", "Preparing Update…", "Restarting…", "Try Again"].contains(label),
          let dark = request["dark"] as? Bool, let pressed = request["pressed"] as? Bool,
          let disabled = request["disabled"] as? Bool, let animate = request["animate"] as? Bool
    else { return fail() }
    var target = window
    if let popup = request["popup"] as? [Double] {
        guard popup.count == 4, popup.allSatisfy({ $0.isFinite && abs($0) <= 32768 }),
              popup[2] > 0, popup[3] > 0, let screenTop = NSScreen.screens.first?.frame.maxY else { return fail() }
        let matches = NSApp.windows.filter { candidate in
            guard candidate.parent === window, candidate.isVisible,
                  NSStringFromClass(type(of: candidate)) == "PopupWindow" else { return false }
            let frame = candidate.frame
            return abs(frame.minX - popup[0]) <= 1 && abs(screenTop - frame.maxY - popup[1]) <= 1 &&
                abs(frame.width - popup[2]) <= 1 && abs(frame.height - popup[3]) <= 1
        }
        guard matches.count == 1 else { return fail() }
        target = matches[0]
    }
    guard let content = target.contentView else { return fail() }
    let children = content.subviews.filter { NSStringFromClass(type(of: $0)) == "ChildView" }
    guard children.count == 1 else { return fail() }
    let child = children[0]
    guard clip[0] + clip[2] <= viewport[0], clip[1] + clip[3] <= viewport[1] else { return fail() }
    // BaseWindow expects ChildView to remain its last direct content child.
    // Insert the decoration inside ChildView, above its compositor layers.
    guard NSStringFromClass(type(of: child)) == "ChildView" else { return fail() }
    let sx = content.bounds.width / viewport[0], sy = content.bounds.height / viewport[1]
    guard sx.isFinite, sy.isFinite, sx > 0.5, sx < 4, sy > 0.5, sy < 4 else { return fail() }
    func convert(_ values: [Double]) -> NSRect {
        child.convert(NSRect(x: values[0] * sx, y: content.bounds.height - (values[1] + values[3]) * sy,
                             width: values[2] * sx, height: values[3] * sy), from: content)
    }
    let frame = convert(rect), visible = frame.intersection(convert(clip))
    guard !visible.isEmpty, !visible.isInfinite else { return fail() }
    let color = p3 ? NSColor(displayP3Red: rgba[0], green: rgba[1], blue: rgba[2], alpha: 1)
        : NSColor(red: rgba[0], green: rgba[1], blue: rgba[2], alpha: 1)
    let model = UpdateButton(color: color, label: label, size: frame.size, dark: dark,
                             pressed: pressed, disabled: disabled, animate: animate)
    let view: UpdateButtonClip
    if let old = UpdateButtons.views.object(forKey: window) {
        view = old
        if view.lastRequest == text && view.superview === child && view.frame == visible { return 0 }
        view.host.rootView = model
    } else {
        guard UpdateButtons.views.count < 32 else { return fail() }
        view = UpdateButtonClip(model)
        UpdateButtons.views.setObject(view, forKey: window)
    }
    view.frame = visible
    view.host.frame = NSRect(x: frame.minX - visible.minX,
                            y: child.isFlipped ? frame.minY - visible.minY : visible.maxY - frame.maxY,
                            width: frame.width, height: frame.height)
    if view.superview !== child { child.addSubview(view, positioned: .above, relativeTo: nil) }
    view.lastRequest = text
    view.layoutSubtreeIfNeeded()
    view.displayIfNeeded()
    return 0
}
