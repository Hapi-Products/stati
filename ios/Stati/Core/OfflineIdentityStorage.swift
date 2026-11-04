import Foundation

nonisolated struct OfflineIdentity: Codable, Sendable {
    let sessionFingerprint: String
    let profile: APIRecord
    let computers: [APIRecord]
}
nonisolated enum OfflineIdentityStorage {
    private static var file: URL {
        var name = "OfflineAccount"
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--review-screen") { name = "SimulatorReview/" + name }
        #endif
        return URL.applicationSupportDirectory.appending(path: name + "/account.json")
    }
    static func read(fingerprint: String) -> OfflineIdentity? {
        guard !fingerprint.isEmpty, let data = try? Data(contentsOf: file), let value = try? JSONDecoder().decode(OfflineIdentity.self, from: data),
              value.sessionFingerprint == fingerprint, UUID(uuidString: value.profile.id) != nil, value.profile["status"].text == "active" else { return nil }
        return value
    }
    static func save(_ value: OfflineIdentity) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        try JSONEncoder().encode(value).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    static func clear() { try? FileManager.default.removeItem(at: file) }
}
nonisolated enum OfflineReadPolicy {
    static func permits(_ error: any Error) -> Bool {
        guard let error = error as? URLError else { return false }
        return [.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed].contains(error.code)
    }
}
