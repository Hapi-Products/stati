import Foundation

nonisolated enum DraftStorage {
    static func file(userID: String) throws -> URL {
        guard UUID(uuidString: userID) != nil else { throw APIError(status: 0, message: "Sign in again to save drafts.") }
        var namespace = "Drafts"
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--review-screen") { namespace = "SimulatorReview/" + namespace }
        #endif
        let directory = URL.applicationSupportDirectory.appending(path: namespace + "/" + userID, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return directory.appending(path: "drafts.json")
    }
    static func load(userID: String) throws -> DraftSnapshot {
        let url = try file(userID: userID)
        guard FileManager.default.fileExists(atPath: url.path) else { return DraftSnapshot() }
        return try JSONDecoder().decode(DraftSnapshot.self, from: Data(contentsOf: url))
    }
    static func preserveUnreadable(userID: String) throws {
        let original = try file(userID: userID)
        guard FileManager.default.fileExists(atPath: original.path) else { return }
        let backup = original.deletingLastPathComponent().appending(path: "recovery-" + UUID().uuidString + ".json")
        try FileManager.default.copyItem(at: original, to: backup)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: backup.path)
    }
    static func save(_ value: DraftSnapshot, userID: String) throws { try JSONEncoder().encode(value).write(to: file(userID: userID), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
}
