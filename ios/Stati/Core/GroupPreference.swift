import Foundation

@MainActor enum GroupPreference {
    static func read(ownerID: String, defaults: UserDefaults = .standard) -> GroupSelection {
        guard !ownerID.isEmpty else { return .automatic }
        if let data = defaults.data(forKey: "stati.ipad.groupSelection." + ownerID) {
            return (try? JSONDecoder().decode(GroupSelection.self, from: data)) ?? .automatic
        }
        let legacy = defaults.string(forKey: "stati.ipad.defaultGroup." + ownerID) ?? ""
        if legacy.isEmpty { return .automatic }
        return legacy == "__generic__" ? .allGroups : .legacy(legacy)
    }
    static func save(_ value: GroupSelection, ownerID: String, defaults: UserDefaults = .standard) {
        guard !ownerID.isEmpty, let data = try? JSONEncoder().encode(value) else { return }
        defaults.set(data, forKey: "stati.ipad.groupSelection." + ownerID)
    }
}
