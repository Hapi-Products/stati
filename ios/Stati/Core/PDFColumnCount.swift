import Foundation
nonisolated enum PDFColumnCount: Int, Codable, CaseIterable, Identifiable, Sendable {
    case one = 1, two = 2
    var id: Int { rawValue }
    var title: String { self == .one ? "1 column" : "2 columns" }
}
