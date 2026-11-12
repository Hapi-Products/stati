import SwiftUI

@MainActor @Observable final class IPadPreferences {
    let ownerID: String
    var selection: GroupSelection { didSet { if !reloading { GroupPreference.saveWorship(selection, ownerID: ownerID, defaults: defaults) } } }
    private(set) var message = ""
    @ObservationIgnored private let defaults: UserDefaults
    private var reloading = false
    init(ownerID: String, defaults: UserDefaults = .standard) { self.ownerID = ownerID; self.defaults = defaults; selection = GroupPreference.readWorship(ownerID: ownerID, defaults: defaults) }
    func reload() { reloading = true; defer { reloading = false }; let saved = GroupPreference.readWorship(ownerID: ownerID, defaults: defaults); if selection != saved { selection = saved } }
    func resolve(named: Set<String>, legacy: Set<String>, loaded: Bool) {
        let resolved = selection.resolved(named: named, legacy: legacy, loaded: loaded)
        guard resolved != selection else { return }
        GroupPreference.save(resolved, ownerID: ownerID, defaults: defaults)
        reload()
        message = "Your previous default group is no longer available. Choose another default in Account."
    }
}
