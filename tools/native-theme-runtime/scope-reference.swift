import AppKit
import Foundation

func components(_ color: NSColor) -> [Double] {
    let c = NSColor(cgColor: color.cgColor) ?? color
    return [c.redComponent, c.greenComponent, c.blueComponent, c.alphaComponent].map(Double.init)
}
func luminance(_ c: [Double]) -> Double {
    zip(c.prefix(3), [0.2126, 0.7152, 0.0722]).reduce(0) { sum, pair in
        let (v, weight) = pair
        return sum + weight * (v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4))
    }
}
func hsl(_ c: [Double]) -> (Double, Double, Double) {
    let r = c[0], g = c[1], b = c[2]
    let lo = min(r, g, b), hi = max(r, g, b), lightness = (lo + hi) / 2
    if lo == hi { return (0, 0, lightness) }
    let delta = hi - lo
    let saturation = delta / (lightness > 0.5 ? 2 - hi - lo : hi + lo)
    let hue = (hi == r ? (g - b) / delta + (g < b ? 6 : 0) : hi == g ? (b - r) / delta + 2 : (r - g) / delta + 4) / 6
    return (hue, saturation, lightness)
}
func rgb(_ h: Double, _ s: Double, _ l: Double) -> [Double] {
    if s == 0 { return [l, l, l] }
    let q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
    func channel(_ raw: Double) -> Double {
        let t = raw < 0 ? raw + 1 : raw > 1 ? raw - 1 : raw
        if t < 1 / 6 { return p + (q - p) * 6 * t }
        if t < 0.5 { return q }
        if t < 2 / 3 { return p + (q - p) * (2 / 3 - t) * 6 }
        return p
    }
    return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
}
func adjust(_ input: NSColor, _ low: Double, _ high: Double) -> [Double] {
 var c = input
 let initial = luminance(components(c))
 let dir = initial < low ? 1.0 : initial > high ? -1.0 : 0.0
 for _ in 0...100 {
  let luma = luminance(components(c))
  if dir == 0 || (dir > 0 ? luma >= low : luma <= high) { return components(c.usingColorSpace(.extendedSRGB)!) }
  let values = components(c), (h,s,l) = hsl(values)
  let out = rgb(h,s,max(0,min(1,l+dir*0.01))) + [values[3]]
  c = NSColor(colorSpace: c.colorSpace, components: out.map { CGFloat($0) }, count: 4)
 }
 fatalError("unbounded palette")
}
var result: [[String:Any]] = []
let fixtures: [(String, [Double], Bool)] = [("YouTube", [1.0,0,0],true),("GitHub",[116.0/255,63.0/255,199.0/255],true),("X",[0.0,0,0],true),("Google Maps",[251.0/255,188.0/255,5.0/255],true),("sRGB red",[1.0,0,0],false),("white",[1.0,1,1],false)]
for (name, values, p3) in fixtures {
 let c = NSColor(colorSpace:p3 ? .displayP3 : .sRGB,components:(values+[1]).map { CGFloat($0) },count:4)
 let light = adjust(c,0.85,0.95),dark = adjust(c,0,0.1)
 result.append(["name":name,"space":p3 ? "display-p3":"srgb","rgba":values+[1],"dark":light.prefix(3).map{$0*0.5}+[1],"light":dark.prefix(3).map{$0*0.4+0.6}+[1]])
}
print(String(data:try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
