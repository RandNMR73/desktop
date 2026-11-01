/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import AppKit
import CoreImage
import ImageIO
import SwiftUI

// The selection outline is an image, not a dominant-color swatch. Keep Core
// Image's working color space, expanded Gaussian extent, and AppKit image
// interpolation: cropping before enlargement changes multi-color outlines.
func favoriteOutlineImage(_ data: Data, iconSize: Double, scale: Double) -> Data? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? Int,
          let height = properties[kCGImagePropertyPixelHeight] as? Int,
          width > 0, height > 0, width <= 512, height <= 512,
          let original = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
    let input = CIImage(cgImage: original)
    let blurred = input.applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 5])
    let adjusted = blurred.applyingFilter("CIColorControls", parameters: [
        kCIInputSaturationKey: 1.5, kCIInputBrightnessKey: 0.05, kCIInputContrastKey: 0.85])
    let filtered = FavoriteOutlineJobs.context.createCGImage(adjusted, from: adjusted.extent) ?? original
    let image = NSImage(cgImage: filtered, size: CGSize(width: filtered.width, height: filtered.height))
    let bounds = CGRect(x: 0, y: 0, width: 47, height: 47)
    let composite = NSImage(size: bounds.size)
    composite.lockFocus()
    let size = 47 / 5 * iconSize
    image.draw(in: CGRect(x: (47 - size) / 2, y: (47 - size) / 2, width: size, height: size))
    composite.unlockFocus()

    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil,
        pixelsWide: Int((47 * scale).rounded()), pixelsHigh: Int((47 * scale).rounded()),
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    bitmap.size = bounds.size
    guard let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics
    graphics.cgContext.clear(bounds)
    var mask = Path(roundedRect: bounds, cornerSize: CGSize(width: 12, height: 12), style: .continuous)
    mask.addPath(RoundedRectangle(cornerRadius: 10, style: .continuous)
        .path(in: bounds.insetBy(dx: 2, dy: 2)))
    graphics.cgContext.addPath(mask.cgPath)
    graphics.cgContext.clip(using: .evenOdd)
    composite.draw(in: bounds)
    NSGraphicsContext.restoreGraphicsState()
    return bitmap.representation(using: .png, properties: [:])
}

private final class FavoriteOutlineJob {
    let data: Data
    let iconSize: Double
    let scale: Double
    var result: Data?
    var completed = false
    init(_ data: Data, _ iconSize: Double, _ scale: Double) {
        self.data = data; self.iconSize = iconSize; self.scale = scale
    }
}

private enum FavoriteOutlineJobs {
    static let lock = NSLock()
    static let queue = DispatchQueue(label: "zen.favorite-outline", qos: .userInitiated)
    static let context = CIContext()
    static var jobs: [UInt32: FavoriteOutlineJob] = [:]
    static var next: UInt32 = 0
    static var workers = 0
}

@_cdecl("zen_favorite_outline_version")
public func favoriteOutlineVersion() -> Int32 { 1 }

// Copy bounded image data before returning; no Gecko pointers or callbacks are
// used off-thread. Bound queued workers separately from released owner handles.
@_cdecl("zen_favorite_outline_request")
public func favoriteOutlineRequest(_ bytes: UnsafePointer<UInt8>?, _ length: UInt32,
                                   _ iconSize: Double, _ scale: Double) -> UInt32 {
    guard let bytes, length > 0, length <= 1_048_576,
          iconSize.isFinite, iconSize >= 1, iconSize <= 64,
          scale.isFinite, scale >= 1, scale <= 4 else { return 0 }
    FavoriteOutlineJobs.lock.lock()
    defer { FavoriteOutlineJobs.lock.unlock() }
    guard FavoriteOutlineJobs.jobs.count < 32, FavoriteOutlineJobs.workers < 32 else { return 0 }
    repeat { FavoriteOutlineJobs.next &+= 1 }
    while FavoriteOutlineJobs.next == 0 || FavoriteOutlineJobs.jobs[FavoriteOutlineJobs.next] != nil
    let key = FavoriteOutlineJobs.next
    let job = FavoriteOutlineJob(Data(bytes: bytes, count: Int(length)), iconSize, scale)
    FavoriteOutlineJobs.jobs[key] = job
    FavoriteOutlineJobs.workers += 1
    FavoriteOutlineJobs.queue.async {
        autoreleasepool {
            FavoriteOutlineJobs.lock.lock()
            let current = FavoriteOutlineJobs.jobs[key] === job
            FavoriteOutlineJobs.lock.unlock()
            let data = current ? favoriteOutlineImage(job.data, iconSize: job.iconSize, scale: job.scale) : nil
            FavoriteOutlineJobs.lock.lock()
            if FavoriteOutlineJobs.jobs[key] === job {
                job.result = data
                job.completed = true
            }
            FavoriteOutlineJobs.workers -= 1
            FavoriteOutlineJobs.lock.unlock()
        }
    }
    return key
}

// 0 pending, -1 invalid/failed, positive required/result byte count.
@_cdecl("zen_favorite_outline_result")
public func favoriteOutlineResult(_ key: UInt32, _ output: UnsafeMutablePointer<UInt8>?,
                                  _ capacity: UInt32) -> Int32 {
    FavoriteOutlineJobs.lock.lock()
    defer { FavoriteOutlineJobs.lock.unlock() }
    guard let job = FavoriteOutlineJobs.jobs[key] else { return -1 }
    guard job.completed else { return 0 }
    guard let result = job.result, !result.isEmpty, result.count <= 262_144 else { return -1 }
    if let output {
        guard capacity >= result.count else { return -1 }
        result.copyBytes(to: output, count: result.count)
    }
    return Int32(result.count)
}

@_cdecl("zen_favorite_outline_release")
public func favoriteOutlineRelease(_ key: UInt32) {
    FavoriteOutlineJobs.lock.lock()
    FavoriteOutlineJobs.jobs.removeValue(forKey: key)
    FavoriteOutlineJobs.lock.unlock()
}
