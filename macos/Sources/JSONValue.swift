import Foundation

enum JSONValue: Codable, Sendable, Equatable {
    case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }
    subscript(_ key: String) -> JSONValue { if case .object(let v) = self { return v[key] ?? .null }; return .null }
    var string: String { if case .string(let v) = self { return v }; return "" }
    var bool: Bool { if case .bool(let v) = self { return v }; return false }
    var array: [JSONValue] { if case .array(let v) = self { return v }; return [] }
    var number: Double { if case .number(let v) = self { return v }; return 0 }
    var id: String { self["id"].string }
    var displayName: String { for key in ["title", "filename", "name", "display_name", "text"] { if !self[key].string.isEmpty { return self[key].string } }; return id }
}

struct EngineFailure: LocalizedError, Sendable {
    let message: String
    var errorDescription: String? { message }
}
