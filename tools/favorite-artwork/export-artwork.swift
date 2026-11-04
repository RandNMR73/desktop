import AppKit
let output = URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true)
try FileManager.default.createDirectory(at:output,withIntermediateDirectories:true)
let bundle = Bundle(path:"/Applications/Arc.app/Contents/Resources/ARCClients_BaseAssets.bundle")!
let names=["TwitterAppTrayIcon","GmailAppTrayIcon","SpotifyAppTrayIcon","WhatsAppAppTrayIcon","YouTubeAppTrayIcon"]
var results:[[String:Any]]=[]
for (appearanceName,label) in [(NSAppearance.Name.aqua,"light"),(.darkAqua,"dark")] {
 let appearance=NSAppearance(named:appearanceName)!
 appearance.performAsCurrentDrawingAppearance {
  for name in names {
   let img=bundle.image(forResource:name)!
   let rep=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:80,pixelsHigh:80,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
   rep.size=NSSize(width:40,height:40)
   NSGraphicsContext.saveGraphicsState()
   NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:rep)
   img.draw(in:NSRect(x:0,y:0,width:40,height:40),from:.zero,operation:.copy,fraction:1)
   NSGraphicsContext.restoreGraphicsState()
   let filename="\(name)-\(label).png"
   try! rep.representation(using:.png,properties:[:])!.write(to:output.appendingPathComponent(filename))
   results.append(["name":name,"appearance":label,"width":img.size.width,"height":img.size.height,"template":img.isTemplate,"filename":filename])
  }
 }
}
print(String(data:try! JSONSerialization.data(withJSONObject:results,options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
