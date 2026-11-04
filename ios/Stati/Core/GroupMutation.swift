import Foundation

nonisolated struct GroupMutation: Codable, Equatable, Sendable {
    let id: String
    let ownerID: String
    let groupOwnerID: String
    let revision: Int?
    let name: String
    let memberIDs: [String]
    var body: JSONValue {
        var fields: [String: JSONValue] = ["name": .string(name), "memberIds": .array(memberIDs.map(JSONValue.string))]
        if let revision { fields["revision"] = .number(Double(revision)) }
        else { fields["id"] = .string(id) }
        return .object(fields)
    }
}
