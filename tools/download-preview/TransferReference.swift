import Foundation
let bytes = ByteCountFormatter()
bytes.allowedUnits = [.useKB, .useMB, .useGB, .useTB]
bytes.includesUnit = true
bytes.isAdaptive = true
bytes.allowsNonnumericFormatting = true
bytes.zeroPadsFractionDigits = true
let duration = DateComponentsFormatter()
duration.unitsStyle = .abbreviated
duration.zeroFormattingBehavior = [.dropLeading, .dropMiddle, .dropTrailing]
duration.allowedUnits = [.day, .hour, .minute, .second]
let now = Date(timeIntervalSince1970: 1793476800)
func transfer(_ current: Int64, _ total: Int64?, _ remaining: Int?) -> String {
    var parts: [String] = []
    if current > 0, let total, total > 0 {
        var downloaded = bytes.string(fromByteCount: current)
        let all = bytes.string(fromByteCount: total)
        let c = downloaded.split(separator: " ")
        let t = all.split(separator: " ")
        if c.last == t.last, let first = c.first { downloaded = String(first) }
        parts.append(downloaded + "/" + all)
    }
    if let remaining, remaining > 0,
       let text = duration.string(from: now, to: now.addingTimeInterval(Double(remaining))) {
        parts.append(text)
    }
    return parts.joined(separator: " · ")
}
let examples: [(Int64, Int64?, Int?)] = [
    (0,nil,nil),(0,100,nil),(40,100,nil),(400,1000,1),(1200000,3600000,65),
    (123000,3600000,3661),(1234000000,7500000000,90061),(1000,nil,5),
    (1000,0,0),(990000,1000000,1),(1000000,1000000,0),(1,1,-1)
]
let output: [String: Any] = [
 "bytes": [0,1,40,500,999,1000,1234,999000,1000000,1234000,1000000000].map { ["input":$0,"output":bytes.string(fromByteCount:Int64($0))] as [String:Any] },
 "transfers": examples.map { ["current":$0.0,"total":$0.1 as Any? ?? NSNull(),"remaining":$0.2 as Any? ?? NSNull(),"output":transfer($0.0,$0.1,$0.2)] as [String:Any] },
 "labels": ["Paused","Cancelled","Failed to Download","from"].map { ["key":$0,"value":Bundle(path:"/Applications/Arc.app")!.localizedString(forKey:$0,value:nil,table:nil)] },
 "date":now.timeIntervalSince1970,"locale":Locale.current.identifier,"timezone":TimeZone.current.identifier
]
print(String(data:try JSONSerialization.data(withJSONObject:output,options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
