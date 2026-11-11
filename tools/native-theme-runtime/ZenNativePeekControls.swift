/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import AppKit
import SwiftUI

// Paint only. Gecko retains hit testing, commands, focus and accessibility.
// Values are sampled by the existing finite spring controller; this view has
// no timer, independent animation, or callback into browser-owned memory.
struct NativePeekControl: View, Equatable {
    var size: CGSize
    var fill: NSColor
    var foreground: NSColor
    var symbol: String?
    var label = ""
    var labelSize = 13.0
    var labelWidth = 0.0
    var labelGap = 8.0
    var metricScale = 1.0
    var scale = 1.0
    var radius = 4.0
    var shadowOpacity = 0.2
    var opacity = 1.0
    var disabled = false

    var decorationPadding: Double { max(30 * metricScale, (4 * radius + metricScale) * scale) }

    var body: some View {
        HStack(spacing: labelGap * metricScale) {
            if let symbol {
                Image(systemName: symbol).font(.system(size: 15 * metricScale, weight: .semibold))
                    .frame(width: 20 * metricScale, height: 20 * metricScale).opacity(disabled ? 0.5 : 1)
            }
            if !label.isEmpty {
                Text(verbatim: label).font(.system(size: labelSize)).lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .frame(width: labelWidth * metricScale, alignment: .leading).clipped()
            }
        }
        .foregroundStyle(Color(nsColor: foreground))
        .frame(width: size.width / scale, height: size.height / scale)
        .background {
            Capsule(style: .continuous).fill(Color(nsColor: fill))
                .shadow(color: .black.opacity(shadowOpacity), radius: radius, x: 0, y: metricScale)
        }
        .scaleEffect(scale)
        .frame(width: size.width, height: size.height)
        .opacity(opacity)
        .padding(decorationPadding)
        // Gecko already supplies window-relative geometry. A titlebar safe
        // area must not move this decoration away from its existing hit target.
        .ignoresSafeArea()
        .allowsHitTesting(false).accessibilityHidden(true)
    }
}

private final class PeekControlHost: NSHostingView<NativePeekControl> {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

private final class PeekControlsClip: NSView {
    var lastRequest = ""
    var hosts: [PeekControlHost] = []
    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = true
        setAccessibilityHidden(true)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}

private final class PeekOwners {
    var clips: [UInt32: PeekControlsClip] = [:]
}

private enum PeekControls {
    static let windows = NSMapTable<NSWindow, PeekOwners>.weakToStrongObjects()
    static func window(_ handle: UInt64) -> NSWindow? {
        NSApp.windows.first { UInt64(UInt(bitPattern: Unmanaged.passUnretained($0).toOpaque())) == handle }
    }
    static func clear(_ window: NSWindow, _ owner: UInt32) {
        guard let owners = windows.object(forKey: window) else { return }
        owners.clips.removeValue(forKey: owner)?.removeFromSuperview()
        if owners.clips.isEmpty { windows.removeObject(forKey: window) }
    }
}

@_cdecl("zen_peek_controls_version")
public func peekControlsVersion() -> Int32 { 1 }

@_cdecl("zen_peek_controls_clear")
public func peekControlsClear(_ handle: UInt64, _ owner: UInt32) -> Int32 {
    guard Thread.isMainThread else { return 1 }
    guard let window = PeekControls.window(handle) else { return 2 }
    PeekControls.clear(window, owner)
    return 0
}

@_cdecl("zen_peek_controls_sync")
public func peekControlsSync(_ handle: UInt64, _ owner: UInt32, _ json: UnsafePointer<CChar>?) -> Int32 {
    guard Thread.isMainThread else { return 1 }
    guard let window = PeekControls.window(handle) else { return 2 }
    func fail() -> Int32 { PeekControls.clear(window, owner); return 3 }
    guard owner != 0, let json, strnlen(json, 16385) <= 16384,
          let text = String(validatingCString: json), let data = text.data(using: .utf8),
          let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let viewport = request["viewport"] as? [Double], viewport.count == 2,
          viewport.allSatisfy({ $0.isFinite && $0 > 0 && $0 <= 16384 }),
          let buttons = request["buttons"] as? [[String: Any]], !buttons.isEmpty, buttons.count <= 3,
          let content = window.contentView else { return fail() }
    let children = content.subviews.filter { NSStringFromClass(type(of: $0)) == "ChildView" }
    guard children.count == 1 else { return fail() }
    let child = children[0]
    let sx = content.bounds.width / viewport[0], sy = content.bounds.height / viewport[1]
    guard sx.isFinite, sy.isFinite, sx > 0.5, sx < 4, abs(sx - sy) < 0.01 else { return fail() }
    func color(_ value: Any?) -> NSColor? {
        guard let value = value as? [String: Any], let rgba = value["rgba"] as? [Double],
              rgba.count == 4, rgba.allSatisfy({ $0.isFinite && abs($0) <= 4 }),
              rgba[3] >= 0, rgba[3] <= 1, let p3 = value["p3"] as? Bool else { return nil }
        return p3 ? NSColor(displayP3Red: rgba[0], green: rgba[1], blue: rgba[2], alpha: rgba[3])
            : NSColor(colorSpace: .extendedSRGB, components: rgba.map { CGFloat($0) }, count: 4)
    }
    func number(_ row: [String: Any], _ name: String, _ range: ClosedRange<Double>) -> Double? {
        guard let value = row[name] as? Double, value.isFinite, range.contains(value) else { return nil }
        return value
    }
    var models: [(NSRect, NativePeekControl)] = []
    var kinds = Set<String>()
    let symbols = ["close": "xmark", "expand": "arrow.up.left.and.arrow.down.right", "split": "square.split.2x1"]
    for button in buttons {
        guard let kind = button["kind"] as? String, let symbol = symbols[kind], kinds.insert(kind).inserted,
              let rect = button["rect"] as? [Double], rect.count == 4,
              rect.allSatisfy({ $0.isFinite && abs($0) <= 16384 }),
              rect[2] > 0, rect[2] <= 512, rect[3] >= 16, rect[3] <= 128,
              let fill = color(button["fill"]), let foreground = color(button["foreground"]),
              let scale = number(button, "scale", 0.5...1.5),
              let radius = number(button, "radius", 0...12),
              let shadowOpacity = number(button, "shadowOpacity", 0...1),
              let opacity = number(button, "opacity", 0...1),
              let labelSize = number(button, "labelSize", 8...28),
              let labelWidth = number(button, "labelWidth", 0...512),
              let labelGap = number(button, "labelGap", 0...32),
              let label = button["label"] as? String, label.utf8.count <= 256,
              let disabled = button["disabled"] as? Bool else { return fail() }
        let frame = child.convert(NSRect(x: rect[0] * sx, y: content.bounds.height - (rect[1] + rect[3]) * sy,
                                         width: rect[2] * sx, height: rect[3] * sy), from: content)
        let model = NativePeekControl(size: frame.size, fill: fill, foreground: foreground, symbol: symbol,
            label: label, labelSize: labelSize * sx, labelWidth: labelWidth, labelGap: labelGap,
            metricScale: sx, scale: scale, radius: radius * sx,
            shadowOpacity: shadowOpacity, opacity: opacity, disabled: disabled)
        models.append((frame, model))
    }
    let bounds = models.reduce(NSRect.null) {
        $0.union($1.0.insetBy(dx: -$1.1.decorationPadding, dy: -$1.1.decorationPadding))
    }
    let visible = bounds.intersection(child.bounds)
    guard !visible.isEmpty, !visible.isInfinite else { return fail() }
    let owners: PeekOwners
    if let existing = PeekControls.windows.object(forKey: window) { owners = existing }
    else {
        guard PeekControls.windows.count < 32 else { return fail() }
        owners = PeekOwners()
        PeekControls.windows.setObject(owners, forKey: window)
    }
    let clip: PeekControlsClip
    if let existing = owners.clips[owner] { clip = existing }
    else {
        guard owners.clips.count < 4 else { return fail() }
        clip = PeekControlsClip(frame: visible)
        owners.clips[owner] = clip
    }
    if clip.lastRequest == text && clip.superview === child && clip.frame == visible { return 0 }
    clip.frame = visible
    while clip.hosts.count > models.count { clip.hosts.removeLast().removeFromSuperview() }
    for (index, entry) in models.enumerated() {
        let (frame, model) = entry
        let padding = model.decorationPadding
        let host: PeekControlHost
        if index < clip.hosts.count {
            host = clip.hosts[index]
            // Hover normally changes one control. Moving the rail changes
            // only host geometry. Keep the other SwiftUI graphs untouched.
            if host.rootView != model { host.rootView = model }
        }
        else {
            host = PeekControlHost(rootView: model)
            host.setAccessibilityHidden(true)
            clip.hosts.append(host)
            clip.addSubview(host)
        }
        let hostFrame = NSRect(x: frame.minX - visible.minX - padding,
            y: (child.isFlipped ? frame.minY - visible.minY : visible.maxY - frame.maxY) - padding,
            width: frame.width + 2 * padding, height: frame.height + 2 * padding)
        if host.frame != hostFrame { host.frame = hostFrame }
    }
    // BaseWindow requires the Gecko ChildView to remain the last direct child.
    if clip.superview !== child { child.addSubview(clip, positioned: .above, relativeTo: nil) }
    clip.lastRequest = text
    clip.layoutSubtreeIfNeeded()
    clip.displayIfNeeded()
    return 0
}
