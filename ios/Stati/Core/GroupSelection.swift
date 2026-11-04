import Foundation

nonisolated enum GroupSelection: Codable, Hashable, Sendable {
    case automatic
    case originalSongs
    case allGroups
    case named(String)
    case legacy(String)

    var hidesGroups: Bool { self == .originalSongs }
    func resolved(named: Set<String>, legacy: Set<String>, loaded: Bool) -> Self {
        guard loaded else { return self }
        switch self {
        case .named(let id): return named.contains(id) ? self : .allGroups
        case .legacy(let label): return legacy.contains(label) ? self : .allGroups
        default: return self
        }
    }
}
