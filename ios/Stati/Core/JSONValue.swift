import Foundation

/// Preserve every server field when editing a service, including older metadata.
nonisolated enum JSONValue: Codable, Sendable, Equatable {
    case string(String), number(Double), bool(Bool), array([JSONValue]), object([String: JSONValue]), null
    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }
    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
    var text: String { if case .string(let value) = self { value } else { "" } }
    var flag: Bool { if case .bool(let value) = self { value } else if case .number(let value) = self { value != 0 } else { false } }
    var number: Double { if case .number(let value) = self { value } else { 0 } }
    var items: [JSONValue] { if case .array(let value) = self { value } else { [] } }
    var fields: [String: JSONValue] { if case .object(let value) = self { value } else { [:] } }
    subscript(_ key: String) -> JSONValue { fields[key] ?? .null }
    var records: [APIRecord] { items.map { APIRecord(raw: $0.fields) } }
}
