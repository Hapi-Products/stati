import Foundation

nonisolated struct APIRecord: Identifiable, Codable, Sendable, Equatable {
    var raw: [String: JSONValue]
    var id: String { self["id"].text }
    subscript(_ key: String) -> JSONValue {
        get { raw[key] ?? .null }
        set { raw[key] = newValue }
    }
    var title: String { self["title"].text }
    var name: String { self["name"].text }
    var personName: String { self["first_name"].text + " " + self["last_initial"].text + "." }
    var roleLabel: String {
        if self["role"].text == "admin" { return "Administrator" }
        return ["worship_leader": "Worship leader", "worship_member": "Worship member", "pastor": "Pastor", "choir_director": "Choir director", "commenter": "Commenter"][self["ministryRole"].text] ?? "Member"
    }
    var value: JSONValue { .object(raw) }
}
