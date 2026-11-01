import AppKit
import Foundation

@main
struct TestFavoriteOutline {
    static func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        precondition(condition(), message)
    }
    static func fixture(_ color: (Int, Int) -> (UInt8, UInt8, UInt8, UInt8)) -> Data {
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 32, pixelsHigh: 32,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bitmapFormat: .alphaNonpremultiplied,
            bytesPerRow: 128, bitsPerPixel: 32)!
        for y in 0..<32 { for x in 0..<32 {
            let c = color(x, y), i = y * 128 + x * 4
            bitmap.bitmapData![i] = c.0; bitmap.bitmapData![i+1] = c.1
            bitmap.bitmapData![i+2] = c.2; bitmap.bitmapData![i+3] = c.3
        } }
        return bitmap.representation(using: .png, properties: [:])!
    }
    static func request(_ data: Data, _ size: Double = 16, _ scale: Double = 2) -> UInt32 {
        data.withUnsafeBytes { favoriteOutlineRequest($0.bindMemory(to: UInt8.self).baseAddress,
            UInt32(data.count), size, scale) }
    }
    static func finish(_ id: UInt32) -> Data? {
        for _ in 0..<500 {
            let count = favoriteOutlineResult(id, nil, 0)
            if count < 0 { return nil }
            if count > 0 {
                var result = Data(count: Int(count))
                let copied = result.withUnsafeMutableBytes {
                    favoriteOutlineResult(id, $0.bindMemory(to: UInt8.self).baseAddress, UInt32(count))
                }
                check(copied == count, "copy count")
                return result
            }
            Thread.sleep(forTimeInterval: 0.01)
        }
        fatalError("native request timeout")
    }
    static func main() {
        let start = ProcessInfo.processInfo.systemUptime
        let red = fixture { _, _ in (255, 0, 0, 255) }
        let mosaic = fixture { x, y in x < 16
            ? (y < 16 ? (255, 0, 0, 255) : (0, 0, 255, 255))
            : (y < 16 ? (0, 255, 0, 255) : (255, 255, 0, 255)) }
        var checks = 0
        for (name, input) in [("red", red), ("mosaic", mosaic),
            ("transparent", fixture { _, _ in (0, 0, 0, 0) }),
            ("monochrome", fixture { x, _ in x < 16 ? (0, 0, 0, 255) : (255, 255, 255, 255) })] {
            let id = request(input)
            check(id != 0, "request accepted")
            guard let data = finish(id), let bitmap = NSBitmapImageRep(data: data) else { fatalError("output missing") }
            check(bitmap.pixelsWide == 94 && bitmap.pixelsHigh == 94, "retina size")
            check(bitmap.colorAt(x: 47, y: 47)!.alphaComponent == 0, "hollow center")
            check(bitmap.colorAt(x: 0, y: 0)!.alphaComponent == 0, "clear corner")
            for y in 25..<69 { for x in 25..<69 {
                check(bitmap.colorAt(x: x, y: y)!.alphaComponent == 0, "interior stays transparent")
            } }
            if name == "red" {
                let color = bitmap.colorAt(x: 47, y: 1)!.usingColorSpace(.sRGB)!
                check(color.redComponent > color.greenComponent + 0.4, "red outline remains red")
            }
            if name == "mosaic" {
                let a = bitmap.colorAt(x: 1, y: 25)!.usingColorSpace(.sRGB)!
                let b = bitmap.colorAt(x: 92, y: 25)!.usingColorSpace(.sRGB)!
                check(abs(a.redComponent-b.redComponent)+abs(a.greenComponent-b.greenComponent) > 0.4,
                    "spatial colors are preserved")
            }
            favoriteOutlineRelease(id)
            check(favoriteOutlineResult(id, nil, 0) == -1, "released result inaccessible")
            checks += 5
        }
        check(request(red, .nan) == 0 && request(red, 16, 100) == 0, "invalid geometry rejected")
        let invalid = request(Data([1, 2, 3]))
        check(finish(invalid) == nil, "invalid image rejected")
        favoriteOutlineRelease(invalid)
        var ids: [UInt32] = []
        for _ in 0..<32 { ids.append(request(red)) }
        check(ids.allSatisfy { $0 != 0 }, "bounded capacity available")
        check(request(red) == 0, "outstanding request bound")
        for id in ids { favoriteOutlineRelease(id) }
        check(ids.allSatisfy { favoriteOutlineResult($0, nil, 0) == -1 }, "cancellation releases every handle")
        checks += 5
        print("{\"ok\":true,\"checks\":\(checks),\"elapsedMs\":\((ProcessInfo.processInfo.systemUptime-start)*1000)}")
    }
}
