import Foundation
nonisolated enum RecentRetention: Int, Codable, CaseIterable, Identifiable, Sendable {
    case never = 0, day = 1, week = 7, fortnight = 14
    var id: Int { rawValue }
    var title: String { switch self { case .never: "Never"; case .day: "After a day"; case .week: "After a week"; case .fortnight: "After two weeks" } }
    func cutoff(now: Date = .now) -> Date? { self == .never ? nil : now.addingTimeInterval(-Double(rawValue) * 86400) }
}
