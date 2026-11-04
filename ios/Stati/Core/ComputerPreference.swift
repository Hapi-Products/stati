import Foundation

@MainActor enum ComputerPreference {
    static func read(ownerID: String, defaults: UserDefaults = .standard) -> String {
        guard !ownerID.isEmpty else { return "" }; return defaults.string(forKey: "stati.defaultComputer." + ownerID) ?? ""
    }
    static func save(_ id: String, ownerID: String, defaults: UserDefaults = .standard) {
        guard !ownerID.isEmpty else { return }; defaults.set(id, forKey: "stati.defaultComputer." + ownerID)
    }
    static func resolve(preferred: String, current: String, available: [String]) -> String {
        if available.contains(current) { return current }
        if available.contains(preferred) { return preferred }
        return available.first ?? ""
    }
}
