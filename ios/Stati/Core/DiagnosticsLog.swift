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
            case .server(let status) where (100...599).contains(status): "Request failed (HTTP \(status))"
            case .server: "Unexpected server response"
            }
        }
    }

    private static let key = "stati.diagnostics.recentFailures"
    private static var nextPrune = Date.distantPast

    static var entries: [String] { prune() }

    @discardableResult
    static func prune(now: Date = .now, defaults: UserDefaults = .standard) -> [String] {
        let saved = defaults.stringArray(forKey: key) ?? []
        let cutoff = now.addingTimeInterval(-86_400)
        let kept = saved.filter { entry in
            guard let stamp = entry.split(separator: " ", maxSplits: 1).first,
                  let time = try? Date.ISO8601FormatStyle().parse(String(stamp)) else { return false }
            return time > cutoff && time <= now
        }
        if kept != saved { defaults.set(kept, forKey: key) }
        return kept
    }

    static func record(_ area: Area, _ failure: Failure) {
        let timestamp = Date.now.ISO8601Format()
        let entry = "\(timestamp) · \(area.rawValue) · \(failure.description)"
        let defaults = UserDefaults.standard
        let now = Date.now
        if now >= nextPrune {
            prune(now: now, defaults: defaults)
            nextPrune = now.addingTimeInterval(900)
        }
        defaults.set([entry] + (defaults.stringArray(forKey: key) ?? []), forKey: key)
    }
}
