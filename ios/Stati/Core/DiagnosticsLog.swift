import Foundation

@MainActor
enum DiagnosticsLog {
    enum Area: String {
        case connection = "Connection"
        case account = "Account"
        case songs = "Songs"
        case services = "Services"
        case groups = "Groups"
        case files = "Files"

        init(path: String) {
            let resource = path.split(separator: "/").drop(while: { $0 == "api" }).first?.split(separator: "?").first
            switch resource {
            case "songs", "catalog": self = .songs
            case "services": self = .services
            case "worship-groups", "group-materials": self = .groups
            case "transfers", "files": self = .files
            case "me", "members", "auth", "passkeys": self = .account
            default: self = .connection
            }
        }
    }

    enum Failure {
        case transport
        case invalidResponse
        case server(Int)

        var description: String {
            switch self {
            case .transport: "Network request failed"
            case .invalidResponse: "Unexpected server response"
            case .server(let status): "Request failed (HTTP \(status))"
            }
        }
    }

    private static let key = "stati.diagnostics.recentFailures"
    static var entries: [String] { UserDefaults.standard.stringArray(forKey: key) ?? [] }

    static func record(_ area: Area, _ failure: Failure) {
        let timestamp = Date.now.ISO8601Format()
        let entry = "\(timestamp) · \(area.rawValue) · \(failure.description)"
        UserDefaults.standard.set([entry] + entries.prefix(49), forKey: key)
    }
}
