import Foundation

@MainActor struct GroupDraftStorage {
    let storageDirectory: URL?
    init(storageDirectory: URL? = nil) { self.storageDirectory = storageDirectory }
    private func folder(_ ownerID: String) throws -> URL {
        guard UUID(uuidString: ownerID) != nil else { throw failure() }
        var namespace = "GroupDrafts"
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route != nil { namespace = "SimulatorReview/" + namespace }
        #endif
        let root = storageDirectory ?? URL.applicationSupportDirectory.appending(path: namespace, directoryHint: .isDirectory)
        let folder = root.appending(path: ownerID, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return folder
    }
    func load(ownerID: String) throws -> [GroupEditDraft] {
        let files = try FileManager.default.contentsOfDirectory(at: folder(ownerID), includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]).filter { $0.pathExtension == "json" }
        guard files.count <= 100 else { throw failure() }
        return try files.map { file in
            let metadata = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard metadata.isRegularFile == true, metadata.isSymbolicLink != true, (metadata.fileSize ?? Int.max) <= 64 * 1024 else { throw failure() }
            let value = try JSONDecoder().decode(GroupEditDraft.self, from: Data(contentsOf: file))
            try validate(value)
            guard value.ownerID == ownerID, file.lastPathComponent == value.id + ".json" else { throw failure() }
            return value
        }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
    /// replacingResolved is allowed only after confirmed absence/unchanged base or explicit saved-version resolution.
    func save(_ draft: GroupEditDraft, replacingResolved: GroupMutation? = nil) throws {
        try validate(draft)
        let previous = try load(ownerID: draft.ownerID).first { $0.id == draft.id }
        if let pending = previous?.pending, pending != draft.pending, pending != replacingResolved { throw failure() }
        let bytes = try JSONEncoder().encode(draft)
        guard bytes.count <= 64 * 1024 else { throw failure() }
        try bytes.write(to: folder(draft.ownerID).appending(path: draft.id + ".json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func remove(_ draft: GroupEditDraft) throws {
        let existing = try load(ownerID: draft.ownerID).first { $0.id == draft.id }
        guard existing == draft else { throw failure() }
        try FileManager.default.removeItem(at: folder(draft.ownerID).appending(path: draft.id + ".json"))
    }
    private func validate(_ value: GroupEditDraft) throws {
        guard UUID(uuidString: value.ownerID) != nil, UUID(uuidString: value.id) != nil, UUID(uuidString: value.groupOwnerID) != nil,
              value.memberIDs.count <= 101, value.memberIDs.allSatisfy({ UUID(uuidString: $0) != nil }), value.revision == nil || (value.revision ?? 0) > 0 else { throw failure() }
        if let pending = value.pending {
            guard pending.id == value.id, pending.ownerID == value.ownerID, pending.groupOwnerID == value.groupOwnerID, pending.revision == value.revision,
                  !pending.name.isEmpty, pending.name.utf16.count <= 80, pending.memberIDs.count <= 100,
                  Set(pending.memberIDs).count == pending.memberIDs.count, pending.memberIDs.allSatisfy({ UUID(uuidString: $0) != nil }) else { throw failure() }
        }
    }
    private func failure() -> NSError { NSError(domain: "StatiGroups", code: 1, userInfo: [NSLocalizedDescriptionKey: "A saved group draft could not be verified. Existing drafts have been kept; check them before starting another request."]) }
}
