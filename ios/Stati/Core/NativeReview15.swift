#if DEBUG && targetEnvironment(simulator)
import SwiftUI

@MainActor enum NativeReview15 {
    static let groupID = "a1111111-1111-4111-8111-111111111111"
    static let memberID = "a2222222-2222-4222-8222-222222222222"
    static var emptyGroups: Bool { ["ipad-groups-none", "ipad-original"].contains(NativeReview.route ?? "") }
    static var members: [JSONValue] { [.object(["id": .string(NativeReview.userID), "name": .string("Sample M."), "photoUrl": NativeReview.person["photoUrl"]]), .object(["id": .string(memberID), "name": .string("Sample N.")])] }
    static var group: JSONValue { .object(["id": .string(groupID), "name": .string("Sunday worship"), "ownerId": .string(NativeReview.userID), "revision": .number(1), "memberCount": .number(2), "canManage": .bool(true), "members": .array(members)]) }
    static func configure() {
        guard let route = NativeReview.route, route.hasPrefix("ipad-") || NativeReaderReview.active else { return }
        GroupPreference.save(route == "ipad-original" ? .originalSongs : .automatic, ownerID: NativeReview.userID)
        var settings = SongReaderSettings()
        if route.hasPrefix("reader-document") || route == "ipad-pdf-columns-features" { settings.mode = .document }
        if route.contains("columns") { settings.pdfColumns = .two }
        if route.hasPrefix("reader-text") { settings.mode = .text }
        if ["reader-extra-large", "reader-slides-last"].contains(route) { settings.slideSize = .extraLarge }
        if route == "ipad-browse-list-large" { settings.largePreviews = true }
        if route == "ipad-search" { settings.largePreviews = true }
        if let data = try? JSONEncoder().encode(settings) { UserDefaults.standard.set(data, forKey: "stati.ipad.reader." + NativeReview.userID) }
    }
    static func response(_ request: URLRequest) -> JSONValue? {
        guard NativeReview.route != nil, request.httpMethod == "GET", let path = request.url?.path else { return nil }
        if path == "/api/worship-groups" { return .object(["groups": .array(emptyGroups ? [] : [group]), "canCreate": .bool(!emptyGroups), "nextCursor": .null]) }
        if path == "/api/worship-groups/candidates" { return .object(["members": .array(members), "nextCursor": .null]) }
        if path == "/api/worship-groups/" + groupID { return .object(["group": group]) }
        return nil
    }
}
#endif
