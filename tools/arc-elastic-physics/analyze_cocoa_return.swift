import Foundation
import CoreGraphics
import ImageIO

precondition(CommandLine.arguments.count >= 2, "Supply the capture directory and optional marker column")
let root = URL(fileURLWithPath: CommandLine.arguments[1])
struct Pixels {
    let width: Int
    let height: Int
    var rgba: [UInt8]

    init(_ path: URL) {
        let source = CGImageSourceCreateWithURL(path as CFURL, nil)!
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
        width = image.width
        height = image.height
        rgba = [UInt8](repeating: 0, count: width * height * 4)
        rgba.withUnsafeMutableBytes { bytes in
            let context = CGContext(data: bytes.baseAddress, width: width, height: height,
                bitsPerComponent: 8, bytesPerRow: width * 4,
                space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
    }

}

let times = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("capture-times.json"))) as! [[String: Any]]
let state = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("release-state.json"))) as! [String: Any]
let release = state["release"] as! [String: Any]
precondition(state["ok"] as? Bool == true && release["error"] == nil, "Release failed")
precondition(!times.isEmpty, "No captured frames")
let dispatch = release["dispatchStartedAt"] as! Double
let callback = release["callbackAt"] as! Double
let column = CommandLine.arguments.count > 2 ? Int(CommandLine.arguments[2])! : 1000
var records: [[String: Any]] = []
for frame in times {
 let pixels = Pixels(root.appendingPathComponent(frame["filename"] as! String))
 precondition(column >= 0 && column < pixels.width)
 let rows = (0..<pixels.height).filter { y in
  let i = (y * pixels.width + column) * 4
  return pixels.rgba[i] > 150 && pixels.rgba[i+1] < 110 && pixels.rgba[i+2] < 170
 }
 precondition(!rows.isEmpty, "Missing edge marker")
 records.append(["frame":frame["frame"]!, "filename":frame["filename"]!,
   "captureRelativeToDispatchMS":[(frame["requestedAt"] as! Double)-dispatch, (frame["returnedAt"] as! Double)-dispatch],
   "markerTop":rows.first!])
}
let rest = records.last!["markerTop"] as! Int
for i in records.indices { records[i]["displacementDevicePixels"] = (records[i]["markerTop"] as! Int) - rest }
let report: [String: Any] = ["frames":records, "releaseCallbackLatencyMS":callback-dispatch,
  "finalMarkerTop":rest, "interpretation":"Capture request intervals bound observation time, not compositor presentation time. Control run under build load is not a performance benchmark."]
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:report, options:[.prettyPrinted,.sortedKeys]))
