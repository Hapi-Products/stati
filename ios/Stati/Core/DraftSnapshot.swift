import Foundation
nonisolated struct DraftSnapshot: Codable {
    var tasks: [String: [String: JSONValue]]
    var services: [String: [String: JSONValue]]
    var send: SendDraft
    init(tasks: [String: [String: JSONValue]] = [:], services: [String: [String: JSONValue]] = [:], send: SendDraft = SendDraft()) { self.tasks = tasks; self.services = services; self.send = send }
    private enum CodingKeys: CodingKey { case tasks, services, send }
    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        tasks = try values.decodeIfPresent([String: [String: JSONValue]].self, forKey: .tasks) ?? [:]
        services = try values.decodeIfPresent([String: [String: JSONValue]].self, forKey: .services) ?? [:]
        send = try values.decodeIfPresent(SendDraft.self, forKey: .send) ?? SendDraft()
    }
}
