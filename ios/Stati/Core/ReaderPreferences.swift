import Foundation
import Observation
@MainActor @Observable final class ReaderPreferences {
    let ownerID: String
    var settings: SongReaderSettings { didSet { save(changesFrom: oldValue) } }
    @ObservationIgnored private let defaults: UserDefaults
    private let writesDeviceSettings: Bool
    private var reloading = false
    private var key: String { "stati.ipad.reader." + ownerID }
    init(ownerID: String, defaults: UserDefaults = .standard, writesDeviceSettings: Bool = false) {
        self.ownerID = ownerID
        self.defaults = defaults
        self.writesDeviceSettings = writesDeviceSettings
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

    private func save(changesFrom previous: SongReaderSettings) {
        guard !reloading, !ownerID.isEmpty else { return }
        if writesDeviceSettings {
            func write(_ key: String, _ oldValue: String, _ newValue: String) {
                if oldValue != newValue { defaults.set(newValue, forKey: "stati.reader." + key) }
            }
            write("mode", previous.mode.rawValue, settings.mode.rawValue)
            write("slideSize", previous.slideSize.rawValue, settings.slideSize.rawValue)
            write("transition", previous.transition.rawValue, settings.transition.rawValue)
            write("pdfColumns", String(previous.pdfColumns.rawValue), String(settings.pdfColumns.rawValue))
            write("retention", String(previous.retention.rawValue), String(settings.retention.rawValue))
            write("selectorSource", previous.selectorSource.rawValue, settings.selectorSource.rawValue)
            write("clicker", previous.clickerEnabled ? "on" : "off", settings.clickerEnabled ? "on" : "off")
            write("largePreviews", previous.largePreviews ? "on" : "off", settings.largePreviews ? "on" : "off")
        } else if let bytes = try? JSONEncoder().encode(settings) {
            defaults.set(bytes, forKey: key)
        }
    }
}
