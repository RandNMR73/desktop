import AppKit
import SwiftUI
let bundle=Bundle(path:"/Applications/Arc.app/Contents/Resources/ARCUI_ARCUI.bundle")!
var out:[String:Any]=[:]
for (name,appearance) in [("light",NSAppearance.Name.aqua),("dark",.darkAqua)] {
 NSAppearance(named:appearance)!.performAsCurrentDrawingAppearance {
  var values:[String:Any]=[:]
  for key in ["GrayA6","GrayA7","GrayA11","GrayA12"] {
   let c=NSColor(named:key,bundle:bundle)!.usingColorSpace(.sRGB)!
   values[key]=[c.redComponent,c.greenComponent,c.blueComponent,c.alphaComponent]
  }
  var env=EnvironmentValues();env.colorScheme=name == "light" ? .light:.dark
  for (key,color) in [("primary",Color.primary),("secondary",Color.secondary)] {
   let c=color.resolve(in:env)
   values[key]=[c.red,c.green,c.blue,c.opacity]
  }
  out[name]=values
 }
}
let data=try JSONSerialization.data(withJSONObject:out,options:[.prettyPrinted,.sortedKeys])
try data.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
print(String(data:data,encoding:.utf8)!)
