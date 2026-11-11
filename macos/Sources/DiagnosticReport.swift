import Foundation

struct DiagnosticReport {
    let appVersion: String
    let build: String
    let connection: String
    let latency: Int?
    let protectedStorage: Bool?

    init(_ result: JSONValue, appVersion: String, build: String) {
        self.appVersion = appVersion
        self.build = build
        switch result["connection"].string {
        case "connected": connection = "Connected"
        case "authorization-required": connection = "Authorization required"
        case "timeout": connection = "Timed out"
        case "unavailable": connection = "Unavailable"
        default: connection = "Connection check unavailable"
        }
        let duration = result["latencyMs"].number
        latency = result["latencyMs"] == .null || !duration.isFinite ? nil : Int(max(0, min(duration, 300_000)))
        if case .bool(let available) = result["protectedStorage"] { protectedStorage = available }
        else { protectedStorage = nil }
    }

    var text: String {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        var lines = [
            "Stați Mac \(appVersion) (\(build))",
            "macOS \(version.majorVersion).\(version.minorVersion).\(version.patchVersion)",
            "Connection: \(connection)"
        ]
        if let latency { lines.append("Response time: \(latency) ms") }
        if let protectedStorage { lines.append("Protected storage: \(protectedStorage ? "Available" : "Unavailable")") }
        return lines.joined(separator: "\n")
    }

    var issueURL: URL? {
        var url = URLComponents()
        url.scheme = "https"
        url.host = "github.com"
        url.path = "/Hapi-Products/stati/issues/new"
        url.queryItems = [
            URLQueryItem(name: "title", value: "Mac connection issue"),
            URLQueryItem(name: "body", value: "## What happened?\n\n\n## Diagnostics\n\n```text\n" + text + "\n```")
        ]
        return url.url
    }
}
