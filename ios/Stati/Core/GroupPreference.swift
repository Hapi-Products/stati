import Foundation

@MainActor enum GroupPreference {
    private static let worshipModeKey = "stati.worship.defaultGroupMode"

    static func readWorship(ownerID: String, defaults: UserDefaults = .standard) -> GroupSelection {
        guard !ownerID.isEmpty else { return .automatic }
        switch defaults.string(forKey: worshipModeKey) {
        case "automatic": return .automatic
        case "originalSongs": return .originalSongs
        case "allGroups": return .allGroups
        default: return read(ownerID: ownerID, defaults: defaults)
        }
    }

    static func saveWorship(_ value: GroupSelection, ownerID: String, defaults: UserDefaults = .standard) {
        guard !ownerID.isEmpty else { return }
        switch value {
        case .automatic: defaults.set("automatic", forKey: worshipModeKey)
        case .originalSongs: defaults.set("originalSongs", forKey: worshipModeKey)
        case .allGroups: defaults.set("allGroups", forKey: worshipModeKey)
        case .named, .legacy:
            save(value, ownerID: ownerID, defaults: defaults)
            defaults.set("saved", forKey: worshipModeKey)
        }
    }

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
