import Foundation
import Observation
@MainActor @Observable final class ReaderPreferences {
    let ownerID: String
    var settings: SongReaderSettings { didSet { save() } }
    @ObservationIgnored private let defaults: UserDefaults
    private var reloading = false
    private var key: String { "stati.ipad.reader." + ownerID }
    init(ownerID: String, defaults: UserDefaults = .standard) {
        self.ownerID = ownerID; self.defaults = defaults
        settings = Self.read(ownerID: ownerID, defaults: defaults)
    }
    func reload() {
        reloading = true; defer { reloading = false }
        let saved = Self.read(ownerID: ownerID, defaults: defaults)
        if saved != settings { settings = saved }
    }
    private static func read(ownerID: String, defaults: UserDefaults) -> SongReaderSettings {
        var settings = defaults.data(forKey: "stati.ipad.reader." + ownerID)
            .flatMap { try? JSONDecoder().decode(SongReaderSettings.self, from: $0) } ?? SongReaderSettings()
        let prefix = "stati.reader."
        if let raw = defaults.string(forKey: prefix + "mode"), let value = SongReaderMode(rawValue: raw) { settings.mode = value }
        if let raw = defaults.string(forKey: prefix + "slideSize"), let value = SlideTextSize(rawValue: raw) { settings.slideSize = value }
        if let raw = defaults.string(forKey: prefix + "transition"), let value = ReaderTransition(rawValue: raw) { settings.transition = value }
        if let raw = defaults.string(forKey: prefix + "pdfColumns").flatMap(Int.init), let value = PDFColumnCount(rawValue: raw) { settings.pdfColumns = value }
        if let raw = defaults.string(forKey: prefix + "retention").flatMap(Int.init), let value = RecentRetention(rawValue: raw) { settings.retention = value }
        if let raw = defaults.string(forKey: prefix + "selectorSource"), let value = SongSelectorSource(rawValue: raw) { settings.selectorSource = value }
        if let raw = defaults.string(forKey: prefix + "clicker"), raw == "on" || raw == "off" { settings.clickerEnabled = raw == "on" }
        if let raw = defaults.string(forKey: prefix + "largePreviews"), raw == "on" || raw == "off" { settings.largePreviews = raw == "on" }
        return settings
    }

    private func save() {
        guard !reloading, !ownerID.isEmpty, let bytes = try? JSONEncoder().encode(settings) else { return }
        defaults.set(bytes, forKey: key)
    }
}
