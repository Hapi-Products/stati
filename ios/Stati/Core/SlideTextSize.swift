import Foundation

nonisolated struct SlideTextSize: Codable, Equatable, Sendable {
    static let small = Self(position: 0)
    static let standard = Self(position: 1)
    static let large = Self(position: 2)
    static let extraLarge = Self(position: 3)
    private static let pointSizes: [Double] = [28, 36, 48, 64]

    let sliderPosition: Double

    private init(position: Double) { sliderPosition = position }

    init?(sliderPosition: Double) {
        guard sliderPosition.isFinite, (0...3).contains(sliderPosition) else { return nil }
        self.init(position: sliderPosition)
    }

    init?(rawValue: String) {
        switch rawValue {
        case "small": self = .small
        case "standard": self = .standard
        case "large": self = .large
        case "extraLarge": self = .extraLarge
        default: return nil
        }
    }

    var points: Double {
        let lower = min(Int(sliderPosition), 2)
        let fraction = sliderPosition - Double(lower)
        return Self.pointSizes[lower] + fraction * (Self.pointSizes[lower + 1] - Self.pointSizes[lower])
    }

    init(from decoder: any Decoder) throws {
        let value = try decoder.singleValueContainer()
        if let position = try? value.decode(Double.self), let size = Self(sliderPosition: position) {
            self = size
        } else if let name = try? value.decode(String.self), let size = Self(rawValue: name) {
            self = size
        } else {
            throw DecodingError.dataCorruptedError(in: value, debugDescription: "Invalid slide text size.")
        }
    }

    func encode(to encoder: any Encoder) throws {
        var value = encoder.singleValueContainer()
        try value.encode(sliderPosition)
    }
}
