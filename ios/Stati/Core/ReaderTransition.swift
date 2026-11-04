import Foundation
nonisolated enum ReaderTransition: String, Codable, CaseIterable, Identifiable, Sendable {
    case slide, pageTurn, fade, instant
    var id: String { rawValue }
    var title: String { switch self { case .slide: "Slide"; case .pageTurn: "Page turn"; case .fade: "Fade"; case .instant: "Instant" } }
    func effective(for mode: SongReaderMode, reduceMotion: Bool) -> Self {
        mode == .document ? effective(reduceMotion: reduceMotion) : .instant
    }
    func effective(reduceMotion: Bool) -> Self { reduceMotion ? .instant : self }
}
