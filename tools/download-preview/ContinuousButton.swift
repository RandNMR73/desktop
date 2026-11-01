import SwiftUI
import AppKit
let cg = RoundedRectangle(cornerRadius:5,style:.continuous).path(in:CGRect(x:0,y:0,width:101,height:28)).cgPath
var commands:[String]=[]
func pair(_ point:CGPoint)->String { String(format:"%.6f %.6f",point.x,point.y) }
cg.applyWithBlock { pointer in
 let e=pointer.pointee
 switch e.type {
 case .moveToPoint: commands.append("M"+pair(e.points[0]))
 case .addLineToPoint: commands.append("L"+pair(e.points[0]))
 case .addQuadCurveToPoint: commands.append("Q"+pair(e.points[0])+" "+pair(e.points[1]))
 case .addCurveToPoint: commands.append("C"+pair(e.points[0])+" "+pair(e.points[1])+" "+pair(e.points[2]))
 case .closeSubpath: commands.append("Z")
 @unknown default: fatalError("Unsupported native path element")
 }
}
print(commands.joined(separator:" "))
