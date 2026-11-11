import Foundation
nonisolated struct SongReaderSettings: Codable, Equatable, Sendable {
    var mode: SongReaderMode = .slides
    var transition: ReaderTransition = .slide
    var clickerEnabled = true
    var largePreviews = false
    var pdfColumns: PDFColumnCount = .one
    var slideSize: SlideTextSize = .large
    var selectorSource: SongSelectorSource = .recents
    var retention: RecentRetention = .never
    init() {}
    private enum CodingKeys: String, CodingKey { case mode, transition, clickerEnabled, largePreviews, retention, slideSize, pdfColumns, selectorSource }
    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        selectorSource = try values.decodeIfPresent(SongSelectorSource.self, forKey: .selectorSource) ?? .recents
        mode = try values.decodeIfPresent(SongReaderMode.self, forKey: .mode) ?? .slides
        transition = try values.decodeIfPresent(ReaderTransition.self, forKey: .transition) ?? .slide
        clickerEnabled = try values.decodeIfPresent(Bool.self, forKey: .clickerEnabled) ?? true
        largePreviews = try values.decodeIfPresent(Bool.self, forKey: .largePreviews) ?? false
        retention = try values.decodeIfPresent(RecentRetention.self, forKey: .retention) ?? .never
        pdfColumns = try values.decodeIfPresent(PDFColumnCount.self, forKey: .pdfColumns) ?? .one
        slideSize = try values.decodeIfPresent(SlideTextSize.self, forKey: .slideSize) ?? .large
    }
    func clickerAllowed(onIPad: Bool) -> Bool { onIPad && clickerEnabled }
}

nonisolated enum SongSelectorSource: String, CaseIterable, Identifiable, Codable, Sendable {
    case recents
    case currentService

    var id: Self { self }
    var title: String {
        switch self {
        case .recents: "Recents"
        case .currentService: "Current service"
        }
    }
}
