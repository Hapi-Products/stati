import Foundation

nonisolated struct GroupEditDraft: Codable, Identifiable, Sendable, Equatable {
    let id: String
    let ownerID: String
    let groupOwnerID: String
    let revision: Int?
    var name = ""
    var memberIDs: Set<String> = []
    var memberNames: [String: String]?
    private(set) var pending: GroupMutation?
    init(ownerID: String, id: String = UUID().uuidString.lowercased(), groupOwnerID: String? = nil, revision: Int? = nil) {
        self.id = id; self.ownerID = ownerID; self.groupOwnerID = groupOwnerID ?? ownerID; self.revision = revision
    }
    mutating func freeze() throws -> GroupMutation {
        if let pending { return pending }
        let value = name.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.utf16.count <= 80, !value.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }), memberIDs.subtracting([groupOwnerID]).count <= 100 else {
            throw CocoaError(.validationMissingMandatoryProperty)
        }
        let intent = GroupMutation(id: id, ownerID: ownerID, groupOwnerID: groupOwnerID, revision: revision, name: value, memberIDs: memberIDs.subtracting([groupOwnerID]).sorted())
        pending = intent
        return intent
    }
    mutating func allowCorrection() { pending = nil }
}
