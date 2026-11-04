import SwiftUI

nonisolated enum ServiceSchedule {
    static func date(_ value: Date) -> String { format("yyyy-MM-dd").string(from: value) }
    static func time(_ value: Date) -> String { format("HH:mm").string(from: value) }
    static func read(date: String, time: String) -> Date { format("yyyy-MM-dd HH:mm").date(from: date + " " + time) ?? Date() }
    private static func format(_ value: String) -> DateFormatter { let result = DateFormatter(); result.locale = Locale(identifier: "en_US_POSIX"); result.dateFormat = value; return result }
}
