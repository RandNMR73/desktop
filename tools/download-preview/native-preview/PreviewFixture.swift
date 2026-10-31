import AppKit
import Quartz
import Darwin
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let binary = CommandLine.arguments[1]
let library = dlopen(binary, RTLD_NOW | RTLD_LOCAL)!
let openPreview = unsafeBitCast(dlsym(library,"zen_media_preview_open"), to: (@convention(c) (UInt64, UnsafePointer<CChar>?) -> UInt32).self)
let closePreview = unsafeBitCast(dlsym(library,"zen_media_preview_close"), to: (@convention(c) (UInt32) -> Void).self)
let pollPreview = unsafeBitCast(dlsym(library,"zen_media_preview_poll"), to: (@convention(c) (UInt32, UnsafeMutablePointer<CChar>?, UInt32) -> Int32).self)
let folder = URL(fileURLWithPath: CommandLine.arguments[2])
try! FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
let pdf = folder.appendingPathComponent("Preview fixture.pdf")
let image = folder.appendingPathComponent("Preview fixture.png")
let data = NSMutableData()
let consumer = CGDataConsumer(data:data)!
var media = CGRect(x:0,y:0,width:612,height:792)
let cg = CGContext(consumer:consumer,mediaBox:&media,nil)!
cg.beginPDFPage(nil); cg.setFillColor(NSColor.white.cgColor);cg.fill(media)
cg.setFillColor(NSColor.systemBlue.cgColor);cg.fill(CGRect(x:40,y:40,width:532,height:240));cg.endPDFPage();cg.closePDF()
try! data.write(to:pdf)
let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:640,pixelsHigh:480,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:bitmap)
NSColor.systemGreen.setFill();NSRect(x:0,y:0,width:640,height:480).fill();NSGraphicsContext.restoreGraphicsState()
try! bitmap.representation(using:.png,properties:[:])!.write(to:image)
let window = NSWindow(contentRect:NSRect(x:0,y:0,width:1720,height:970),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false)
window.title="Zen Preview Fixture";window.isReleasedWhenClosed=false;window.appearance=NSAppearance(named:.darkAqua)
window.center();window.makeKeyAndOrderFront(nil)
let handle = UInt64(UInt(bitPattern:Unmanaged.passUnretained(window).toOpaque()))
var labels = ["close":"Close","previous":"Back","next":"Forward","more":"More","openIn":"Open in {app}","show":"Show in Finder","hide":"Hide from Zen","trash":"Move to Trash"]
for kind in ["image","pdf","movie","file"] {labels["open."+kind]="Open "+kind.uppercased();labels["copy."+kind]="Copy "+kind.uppercased()}
let request:[String:Any] = ["items":[["path":pdf.path,"date":"2 weeks ago","token":0],["path":image.path,"date":"1 day ago","token":1]],"index":0,"labels":labels]
let json = String(data:try! JSONSerialization.data(withJSONObject:request),encoding:.utf8)!
let interactive = CommandLine.arguments.contains("--interactive")
var checks = 0
func check(_ valid:Bool,_ name:String) {if !valid {fatalError(name)};checks += 1}
DispatchQueue.main.asyncAfter(deadline:.now()+0.2) {
 check(openPreview(0,json)==0,"invalid window")
 check(openPreview(handle,"{")==0,"invalid JSON")
 let id = openPreview(handle,json)
 check(id != 0,"opened")
 check(window.childWindows?.count==1,"one child")
 let preview = window.childWindows!.first!
 check(preview.frame==window.frame,"same browser frame")
 let root = preview.contentView!
 root.layoutSubtreeIfNeeded()
 let panel = root.subviews.last!
 check(panel.frame.width == max(100,(root.bounds.width*0.8).rounded()-50),"panel width")
 check(panel.frame.height == max(100,(root.bounds.height*0.8).rounded()-50),"panel height")
 check(panel.frame.midX == root.bounds.midX && panel.frame.midY == root.bounds.midY,"center")
 check(panel.layer?.cornerRadius==16,"panel radius")
 check(root.subviews.first!.layer?.cornerRadius==10,"backdrop radius")
 check(abs((root.subviews.first!.layer?.backgroundColor?.alpha ?? 0)-0.7)<0.00001,"backdrop alpha")
 check(pollPreview(id,nil,0)==0,"no idle events")
 if interactive {print("ACTIVE: \(app.isActive) KEY: \(preview.isKeyWindow) MAIN: \(preview.isMainWindow)");print("READY: \(checks) checks passed; panel \(panel.frame)");fflush(stdout);return}
 window.setFrame(NSRect(x:50,y:50,width:1000,height:700),display:true)
 DispatchQueue.main.asyncAfter(deadline:.now()+0.1) {
  check(preview.frame==window.frame,"resize tracks parent")
  let replacement = openPreview(handle,json)
  check(replacement != 0 && replacement != id,"replace preview")
  check(window.childWindows?.count==1,"replacement only child")
  check(pollPreview(id,nil,0)==(-2),"replaced session closed response")
  closePreview(id);closePreview(replacement)
  check(window.childWindows?.isEmpty ?? true,"close detaches")
  check(pollPreview(replacement,nil,0)==(-1),"release invalidates")
  for _ in 0..<32 {let next=openPreview(handle,json);check(next != 0,"repeat open");closePreview(next)}
  let orphan = openPreview(handle,json);window.close()
  check(pollPreview(orphan,nil,0)==(-2),"parent close")
  closePreview(orphan)
  DispatchQueue.main.asyncAfter(deadline:.now()+0.5) {
   print("PASSED \(checks) native lifecycle and geometry checks after autorelease drain")
   app.terminate(nil)
  }
 }
}
app.activate(ignoringOtherApps: true)
app.run()
