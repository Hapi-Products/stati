import Foundation
nonisolated enum SongReaderMode: String, Codable, CaseIterable, Identifiable, Sendable {
    case slides, document, text
    var id: String { rawValue }
    var title: String { switch self { case .slides: "Slides"; case .document: "PDF document"; case .text: "Text" } }
}
