import Foundation
nonisolated enum SlideTextSize: String, Codable, CaseIterable, Identifiable, Sendable {
    case small, standard, large, extraLarge
    var id: String { rawValue }
    var title: String { switch self { case .small: "Small"; case .standard: "Default"; case .large: "Large"; case .extraLarge: "Extra large" } }
    var sliderPosition: Double {
        switch self {
        case .small: 0
        case .standard: 1
        case .large: 2
        case .extraLarge: 3
        }
    }

    init?(sliderPosition: Double) {
        guard sliderPosition.isFinite, (0...3).contains(sliderPosition) else { return nil }
        self = Self.allCases[Int(sliderPosition.rounded())]
    }

    var points: Double { switch self { case .small: 28; case .standard: 36; case .large: 48; case .extraLarge: 64 } }
}
