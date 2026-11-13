import ActivityKit
import Foundation

nonisolated struct ServiceActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let song: String
    }

    let accountID: String
    let computerID: String
    let serviceID: String
    let service: String
    var clickerSessionID: String? = nil

    var clickerURL: URL? {
        guard let clickerSessionID else { return nil }
        return URL(string: "stati-ios://live-clicker/" + clickerSessionID)
    }
}
