import SwiftUI
import Foundation
let spring=Spring(response:0.35,dampingRatio:0.6)
let duration=spring.settlingDuration
let values=(0...120).map { spring.value(target:1,time:duration*Double($0)/120) }
print(try! String(data:JSONSerialization.data(withJSONObject:["response":0.35,"dampingRatio":0.6,"duration":duration,"samples":values],options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
