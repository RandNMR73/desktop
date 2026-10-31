/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import AppKit
import Quartz
import QuickLookThumbnailing
import SwiftUI

// This window belongs to one browser window, not the process-wide Quick Look
// panel. The main-thread ABI never dereferences a pointer supplied by Gecko.
private var previews: [UInt32: MediaPreview] = [:]
private var nextPreview: UInt32 = 0

struct PreviewItem: Decodable {
    let path: String
    let date: String
    let token: Int
    let capture: Bool?
    let title: String?

    var isCapture: Bool { capture == true }
    var displayTitle: String { isCapture ? (title ?? "") : URL(fileURLWithPath: path).lastPathComponent }
    var menuActions: [String] {
        isCapture
            ? ["copy", "copy-source", "open-source", "separator", "message", "airdrop", "separator", "delete-capture"]
            : ["open", "copy", "show", "hide", "trash"]
    }
}

struct PreviewRequest: Decodable {
    let items: [PreviewItem]
    let index: Int
    let labels: [String: String]
    let dark: Bool?
}

func previewPanelFrame(in bounds: NSRect) -> NSRect {
    let size = NSSize(width: max(100, (bounds.width * 0.8).rounded() - 50),
                      height: max(100, (bounds.height * 0.8).rounded() - 50))
    return NSRect(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2,
                  width: size.width, height: size.height)
}

private final class PreviewWindow: NSWindow {
    override var canBecomeKey: Bool { true }
}

private final class PreviewBackdrop: NSView {
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        updateLayer()
    }
    required init?(coder: NSCoder) { nil }
    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() {
        layer?.backgroundColor = NSColor(white: 0, alpha: 0.7).cgColor
        layer?.cornerRadius = 10
        layer?.cornerCurve = .continuous
    }
}

private final class PreviewRoot: NSView {
    let backdrop = PreviewBackdrop()
    let panel = NSView()
    var dismiss: (() -> Void)?
    override init(frame: NSRect) {
        super.init(frame: frame)
        backdrop.wantsLayer = true
        addSubview(backdrop)
        panel.wantsLayer = true
        panel.layer?.backgroundColor = NSColor.white.cgColor
        panel.layer?.cornerRadius = 16
        panel.layer?.cornerCurve = .continuous
        panel.layer?.masksToBounds = true
        addSubview(panel)
    }
    required init?(coder: NSCoder) { nil }
    override func layout() {
        super.layout()
        backdrop.frame = bounds
        panel.frame = previewPanelFrame(in: bounds)
        panel.subviews.first?.frame = panel.bounds
    }
    override func mouseDown(with event: NSEvent) {
        if !panel.frame.contains(convert(event.locationInWindow, from: nil)) { dismiss?() }
    }
}

private struct ToolbarMaterial: NSViewRepresentable {
    @Environment(\.colorScheme) private var scheme
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.blendingMode = .withinWindow
        // The borderless browser child otherwise receives the inactive solid
        // fill from AppKit. Arc retains the active translucent preview material.
        view.state = .active
        return view
    }
    func updateNSView(_ view: NSVisualEffectView, context: Context) {
        // Arc uses the legacy Light/Dark materials, not the newer titlebar material.
        view.material = NSVisualEffectView.Material(rawValue: scheme == .dark ? 2 : 1)!
    }
}

private struct PreviewButtonStyle: ButtonStyle {
    var showBackground = false
    @Environment(\.isEnabled) private var enabled
    @Environment(\.colorScheme) private var scheme
    @State private var hovered = false
    private var background: Color {
        guard showBackground || (hovered && enabled) else { return .clear }
        let stronger = showBackground && hovered && enabled
        if scheme == .dark { return Color(.sRGB, white: 1, opacity: stronger ? 0.15 : 0.10) }
        return Color(.sRGB, red: 0, green: 0, blue: stronger ? 0.092 : 0.09,
                     opacity: stronger ? 0.12 : 0.07)
    }
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.66 : 1)
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(.primary)
            .padding(.horizontal, 10)
            .frame(minWidth: 30, minHeight: 30)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .padding(.vertical, 8)
            .opacity(enabled ? 1 : 0.5)
            .onHover { hovered = $0 }
    }
}

private final class PreviewFile: NSObject, QLPreviewItem {
    let previewItemURL: URL?
    let previewItemTitle: String?
    init(url: URL, title: String) {
        previewItemURL = url
        previewItemTitle = title
    }
}

private struct QuickLookContent: NSViewRepresentable {
    let url: URL
    let title: String
    let onCreate: (QLPreviewView) -> Void
    func makeNSView(context: Context) -> QLPreviewView {
        let view = QLPreviewView(frame: .zero, style: .compact)!
        view.autostarts = true
        // SwiftUI owns teardown. Automatic window close plus dismantle would
        // deactivate Quick Look twice and abort the browser during autorelease.
        view.shouldCloseWithWindow = false
        onCreate(view)
        return view
    }
    func updateNSView(_ view: QLPreviewView, context: Context) {
        // Supply the display title separately from the backing image URL.
        // Some Quick Look providers still derive their AX document name from
        // that URL; capture-specific accessibility needs separate verification.
        let current = view.previewItem as? PreviewFile
        if current?.previewItemURL != url || current?.previewItemTitle != title {
            view.previewItem = PreviewFile(url: url, title: title)
        }
    }
    static func dismantleNSView(_ view: QLPreviewView, coordinator: ()) { view.close() }
}

private struct PreviewContent: View {
    @ObservedObject var preview: MediaPreview
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                Button(action: { preview.dismiss() }) { Image(systemName: "xmark") }
                    .accessibilityLabel(preview.label("close"))
                HStack(spacing: 0) {
                    Button(action: { preview.step(-1) }) { Image(systemName: "chevron.backward") }
                        .accessibilityLabel(preview.label("previous"))
                        .disabled(preview.index == 0 || preview.pending)
                    Button(action: { preview.step(1) }) { Image(systemName: "chevron.forward") }
                        .accessibilityLabel(preview.label("next"))
                        .disabled(preview.index == preview.items.count - 1 || preview.pending)
                }
                HStack {
                    Text(preview.item.displayTitle).font(.system(size: 14, weight: .semibold))
                    Text(preview.item.date).font(.system(size: 14)).opacity(0.5)
                }.lineLimit(1)
                Spacer()
                Button(action: { preview.showMenu() }) { Image(systemName: "ellipsis") }
                    .accessibilityLabel(preview.label("more"))
                    .disabled(preview.pending)
                if !preview.item.isCapture && !preview.application.isEmpty {
                    Button(action: { preview.perform("open") }) {
                        HStack(spacing: 4) {
                            Text(preview.label("openIn").replacingOccurrences(of: "{app}", with: preview.application))
                            Image(systemName: "arrow.up.forward")
                        }
                    }.buttonStyle(PreviewButtonStyle(showBackground: true))
                }
            }
            .buttonStyle(PreviewButtonStyle())
            .padding(.horizontal, 8)
            .background(ToolbarMaterial())
            QuickLookContent(url: preview.url, title: preview.item.displayTitle,
                             onCreate: { preview.quickLook = $0 })
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(16)
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(PreviewBackground(image: preview.background))
    }
}

private struct PreviewBackground: View {
    let image: NSImage?
    var body: some View {
        GeometryReader { geometry in
            Color.clear
                .frame(width: geometry.size.width * 0.2, height: geometry.size.height * 0.2)
                .background {
                    if let image { Image(nsImage: image).resizable() }
                }
                .blur(radius: 30)
                .scaleEffect(7)
                .frame(width: geometry.size.width, height: geometry.size.height)
        }.drawingGroup()
    }
}

private final class MediaPreview: NSObject, ObservableObject, NSWindowDelegate {
    let window: PreviewWindow
    weak var parent: NSWindow?
    let labels: [String: String]
    @Published var items: [PreviewItem]
    @Published var index: Int
    @Published var pending = false
    @Published var application = ""
    @Published var background: NSImage?
    var thumbnailRequest: QLThumbnailGenerator.Request?
    var kind = "file"
    var item: PreviewItem { items[index] }
    var url: URL { URL(fileURLWithPath: item.path) }
    weak var quickLook: QLPreviewView?
    var events: [[String: Any]] = []
    var closed = false
    var observers: [NSObjectProtocol] = []
    var keyMonitor: Any?
    var menu: NSMenu?

    init(parent: NSWindow, request: PreviewRequest) {
        self.parent = parent
        labels = request.labels
        items = request.items
        index = request.index
        window = PreviewWindow(contentRect: parent.frame, styleMask: .borderless,
                               backing: .buffered, defer: false)
        super.init()
        window.isReleasedWhenClosed = false
        window.isOpaque = false
        window.backgroundColor = .clear
        window.delegate = self
        window.appearance = request.dark.map { NSAppearance(named: $0 ? .darkAqua : .aqua)! }
            ?? parent.effectiveAppearance
        let root = PreviewRoot(frame: NSRect(origin: .zero, size: parent.frame.size))
        root.dismiss = { [weak self] in self?.dismiss() }
        let controller = NSViewController()
        controller.view = root
        window.contentViewController = controller
        updateItem()
        let content = NSHostingController(rootView: PreviewContent(preview: self))
        controller.addChild(content)
        let host = content.view
        host.frame = root.panel.bounds
        host.autoresizingMask = [.width, .height]
        root.panel.addSubview(host)
        parent.addChildWindow(window, ordered: .above)
        window.setFrame(parent.frame, display: true)
        window.makeKeyAndOrderFront(nil)
        root.needsLayout = true
        root.layoutSubtreeIfNeeded()
        for name in [NSWindow.didMoveNotification, NSWindow.didResizeNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: parent,
                queue: .main) { [weak self] _ in
                    guard let self, let parent = self.parent, !self.closed else { return }
                    self.window.setFrame(parent.frame, display: true)
                })
        }
        observers.append(NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification,
            object: parent, queue: .main) { [weak self] _ in
                self?.parent = nil
                self?.dismiss()
            })
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, !self.closed, self.menu == nil,
                  event.window === self.window else { return event }
            switch event.keyCode {
            case 53: self.dismiss(); return nil
            case 123: self.step(-1); return nil
            case 124: self.step(1); return nil
            default: return event
            }
        }
    }

    func label(_ key: String) -> String { labels[key] ?? key }
    func updateItem() {
        let info = ZenFileDetails(url) as? [String: Any] ?? [:]
        application = info["application"] as? String ?? ""
        kind = info["kind"] as? String ?? "file"
        if let request = thumbnailRequest { QLThumbnailGenerator.shared.cancel(request) }
        background = nil
        let request = QLThumbnailGenerator.Request(fileAt: url, size: NSSize(width: 512, height: 512),
                                                   scale: 1, representationTypes: .thumbnail)
        thumbnailRequest = request
        QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { [weak self] representation, _ in
            DispatchQueue.main.async {
                guard let self, !self.closed, self.thumbnailRequest === request else { return }
                self.background = representation?.nsImage
                self.thumbnailRequest = nil
            }
        }
    }
    func step(_ delta: Int) {
        guard !closed, !pending, items.indices.contains(index + delta) else { return }
        index += delta
        updateItem()
    }
    func showMenu() {
        guard !closed, !pending else { return }
        let popup = NSMenu()
        popup.autoenablesItems = false
        for action in item.menuActions {
            if action == "separator" { popup.addItem(.separator()); continue }
            let key = ["open", "copy"].contains(action) ? action + "." + kind : action
            let entry = NSMenuItem(title: label(key), action: #selector(menuAction(_:)), keyEquivalent: "")
            entry.representedObject = action
            entry.target = self
            popup.addItem(entry)
        }
        menu = popup
        popup.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
        menu = nil
    }
    @objc func menuAction(_ sender: NSMenuItem) {
        if let action = sender.representedObject as? String { perform(action) }
    }
    func perform(_ action: String) {
        guard !closed, !pending else { return }
        if item.isCapture {
            guard item.menuActions.contains(action), action != "separator" else { return }
            pending = true
            events.append(["action": action, "token": item.token])
            return
        }
        switch action {
        case "open": NSWorkspace.shared.open(url)
        case "copy": _ = ZenCopyFile(url, .general)
        case "show": NSWorkspace.shared.activateFileViewerSelecting([url])
        case "hide", "trash":
            pending = true
            events.append(["action": action, "token": item.token])
        default: break
        }
    }
    func finishAction(token: Int, removed: Bool) {
        guard !closed, pending, token == item.token else { return }
        pending = false
        guard removed else { return }
        if items.count == 1 { dismiss(); return }
        items.remove(at: index)
        index = min(index, items.count - 1)
        updateItem()
    }
    func dismiss() {
        guard !closed else { return }
        closed = true
        menu?.cancelTracking()
        if let monitor = keyMonitor { NSEvent.removeMonitor(monitor) }
        keyMonitor = nil
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        if let request = thumbnailRequest { QLThumbnailGenerator.shared.cancel(request) }
        thumbnailRequest = nil
        parent?.removeChildWindow(window)
        window.orderOut(nil)
        window.contentViewController = nil
        window.contentView = nil // break the hosting-view/ObservedObject cycle
        window.close()
        parent?.makeKeyAndOrderFront(nil)
    }
    func windowWillClose(_ notification: Notification) { dismiss() }
}

@_cdecl("zen_media_preview_version")
public func zenMediaPreviewVersion() -> Int32 { 1 }

@_cdecl("zen_media_preview_captures_version")
public func zenMediaPreviewCapturesVersion() -> Int32 { 1 }

@_cdecl("zen_media_preview_open")
public func zenMediaPreviewOpen(_ handle: UInt64, _ json: UnsafePointer<CChar>?) -> UInt32 {
    guard Thread.isMainThread, let json, strnlen(json, 2_097_152) < 2_097_152,
          let string = String(validatingUTF8: json), let data = string.data(using: .utf8),
          let request = try? JSONDecoder().decode(PreviewRequest.self, from: data),
          !request.items.isEmpty, request.items.count <= 512,
          request.items.indices.contains(request.index),
          request.items.allSatisfy({ $0.path.hasPrefix("/") && !$0.path.contains("\0") &&
              (!$0.isCapture || $0.title != nil) }),
          let parent = NSApp.windows.first(where: {
              UInt64(UInt(bitPattern: Unmanaged.passUnretained($0).toOpaque())) == handle
          }), !(parent is PreviewWindow) else { return 0 }
    let selected = URL(fileURLWithPath: request.items[request.index].path)
    guard (try? selected.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { return 0 }
    for existing in previews.values where existing.parent === parent { existing.dismiss() }
    // Unpolled closed sessions are bounded; the caller sees a closed result.
    if previews.count >= 16 { previews = previews.filter { !$0.value.closed } }
    guard previews.count < 16 else { return 0 }
    repeat { nextPreview &+= 1 } while nextPreview == 0 || previews[nextPreview] != nil
    previews[nextPreview] = MediaPreview(parent: parent, request: request)
    return nextPreview
}

@_cdecl("zen_media_preview_poll")
public func zenMediaPreviewPoll(_ id: UInt32, _ output: UnsafeMutablePointer<CChar>?, _ capacity: UInt32) -> Int32 {
    guard Thread.isMainThread else { return -1 }
    guard let preview = previews[id] else { return -1 }
    guard preview.closed || !preview.events.isEmpty else { return 0 }
    guard let data = try? JSONSerialization.data(withJSONObject: ["closed": preview.closed, "events": preview.events]),
          data.count < Int(capacity), let output else { return -2 }
    data.copyBytes(to: UnsafeMutableRawPointer(output).assumingMemoryBound(to: UInt8.self), count: data.count)
    output[data.count] = 0
    preview.events.removeAll()
    return 1
}

@_cdecl("zen_media_preview_action_finished")
public func zenMediaPreviewActionFinished(_ id: UInt32, _ token: Int32, _ removed: Int32) {
    guard Thread.isMainThread else { return }
    previews[id]?.finishAction(token: Int(token), removed: removed != 0)
}

@_cdecl("zen_media_preview_close")
public func zenMediaPreviewClose(_ id: UInt32) {
    guard Thread.isMainThread else { return }
    previews.removeValue(forKey: id)?.dismiss()
}
