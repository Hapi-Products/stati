import Foundation

nonisolated enum SongCommandStorage {
    static func file(ownerID: String) throws -> URL {
        guard UUID(uuidString: ownerID) != nil else { throw APIError(status: 0, message: "Sign in again to keep song requests.") }
        var namespace = "SongCommands"
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--review-screen") { namespace = "SimulatorReview/" + namespace }
        #endif
        let directory = URL.applicationSupportDirectory.appending(path: namespace + "/" + ownerID, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return directory.appending(path: "requests.json")
    }
    static func validate(_ requests: [SongCommand], ownerID: String) -> Bool {
        requests.count <= 100 && requests.allSatisfy { $0.ownerID == ownerID && $0.isValid } && Set(requests.map(\.id)).count == requests.count && Set(requests.map(\.key)).count == requests.count
    }
    static func load(ownerID: String) throws -> [SongCommand] {
        let url = try file(ownerID: ownerID)
        let bytes: Data
        do { bytes = try Data(contentsOf: url) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile { return [] }
        let requests = try JSONDecoder().decode([SongCommand].self, from: bytes)
        guard validate(requests, ownerID: ownerID) else { throw APIError(status: 0, message: "The saved song requests do not match this account.") }
        return requests
    }
    static func save(_ requests: [SongCommand], ownerID: String) throws {
        guard validate(requests, ownerID: ownerID) else { throw APIError(status: 0, message: "The song request could not be safely saved.") }
        try JSONEncoder().encode(requests).write(to: file(ownerID: ownerID), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
