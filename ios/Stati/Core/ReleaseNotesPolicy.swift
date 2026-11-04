import Foundation

nonisolated enum ReleaseNotesPolicy {
    static func shouldPresent(isIPad: Bool, automaticOnIPad: Bool, lastSeen: String, current: String) -> Bool {
        guard !current.isEmpty, lastSeen != current else { return false }
        return isIPad ? automaticOnIPad : !lastSeen.isEmpty
    }
}
