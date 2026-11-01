// Export the same continuous outer path used by the native selection mask.
import SwiftUI
let path = Path(roundedRect: CGRect(x: 0, y: 0, width: 47, height: 47),
                cornerSize: CGSize(width: 12, height: 12), style: .continuous)
func point(_ p: CGPoint) -> String { "\(p.x),\(p.y)" }
var commands: [String] = []
path.cgPath.applyWithBlock { item in
    let e = item.pointee
    switch e.type {
    case .moveToPoint: commands.append("M" + point(e.points[0]))
    case .addLineToPoint: commands.append("L" + point(e.points[0]))
    case .addQuadCurveToPoint: commands.append("Q" + point(e.points[0]) + " " + point(e.points[1]))
    case .addCurveToPoint: commands.append("C" + point(e.points[0]) + " " + point(e.points[1]) + " " + point(e.points[2]))
    case .closeSubpath: commands.append("Z")
    @unknown default: fatalError("Unknown path element")
    }
}
print("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 47 47\"><path fill=\"white\" d=\"\(commands.joined(separator: " "))\"/></svg>")
