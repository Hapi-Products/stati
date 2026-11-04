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
        settings = defaults.data(forKey: "stati.ipad.reader." + ownerID).flatMap { try? JSONDecoder().decode(SongReaderSettings.self, from: $0) } ?? SongReaderSettings()
    }
    func reload() {
        reloading = true; defer { reloading = false }
        let saved = defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(SongReaderSettings.self, from: $0) } ?? SongReaderSettings()
        if saved != settings { settings = saved }
    }
    private func save() {
        guard !reloading, !ownerID.isEmpty, let bytes = try? JSONEncoder().encode(settings) else { return }
        defaults.set(bytes, forKey: key)
    }
}
