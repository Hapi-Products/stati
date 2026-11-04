import Foundation
nonisolated enum IPadSidebarRoute: Hashable, Identifiable {
    case service(String), group(String), folder(String)
    var id: String { switch self { case .service(let id): "service:" + id; case .group(let id): "named:" + id; case .folder(let name): "group:" + name } }
    init?(selection: String) {
        guard let colon = selection.firstIndex(of: ":") else { return nil }
        let value = String(selection[selection.index(after: colon)...]); guard !value.isEmpty else { return nil }
        switch selection[..<colon] { case "service": self = .service(value); case "named": self = .group(value); case "group": self = .folder(value); default: return nil }
    }
}
