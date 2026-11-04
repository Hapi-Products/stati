import SwiftUI

enum TaskTabImage {
    static func symbolName(selected: Bool, hasTasks: Bool) -> String {
        selected && hasTasks ? "checklist" : "checklist.unchecked"
    }
}
