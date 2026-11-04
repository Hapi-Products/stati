import Foundation
nonisolated enum SongExportKind: String, CaseIterable, Identifiable, Sendable {
    case documentPDF, slidePDF, powerPoint
    var id: String { rawValue }
    var title: String { switch self { case .documentPDF: "PDF document"; case .slidePDF: "Slide PDF"; case .powerPoint: "PowerPoint slides" } }
    var symbol: String { switch self { case .documentPDF: "doc.text"; case .slidePDF: "rectangle.stack"; case .powerPoint: "play.rectangle" } }
}
