#if DEBUG && targetEnvironment(simulator)
import SwiftUI

@MainActor enum NativeReview15 {
    private static let followStarted = Date.now
    static let groupID = "a1111111-1111-4111-8111-111111111111"
    static let memberID = "a2222222-2222-4222-8222-222222222222"
    static var emptyGroups: Bool { ["ipad-groups-none", "ipad-original"].contains(NativeReview.route ?? "") }
    static var members: [JSONValue] { [.object(["id": .string(NativeReview.userID), "name": .string("Sample M."), "photoUrl": NativeReview.person["photoUrl"]]), .object(["id": .string(memberID), "name": .string("Sample N.")])] }
    static var group: JSONValue { .object(["id": .string(groupID), "name": .string("Sunday worship"), "ownerId": .string(NativeReview.userID), "revision": .number(1), "memberCount": .number(2), "canManage": .bool(true), "members": .array(members)]) }
    static func configure() {
        guard let route = NativeReview.route, route.hasPrefix("ipad-") || NativeReaderReview.active else { return }
        GroupPreference.save(route == "ipad-original" ? .originalSongs : .automatic, ownerID: NativeReview.userID)
        if route == "ipad-live-activity" { UserDefaults.standard.set(true, forKey: "stati.liveSong.enabled") }
        var settings = SongReaderSettings()
        if route.hasPrefix("reader-document") || route == "ipad-pdf-columns-features" { settings.mode = .document }
        if route.contains("columns") { settings.pdfColumns = .two }
        if route.hasPrefix("reader-text") { settings.mode = .text }
        if ["reader-extra-large", "reader-slides-last"].contains(route) { settings.slideSize = .extraLarge }
        if route == "ipad-browse-list-large" { settings.largePreviews = true }
        if route == "ipad-search" { settings.largePreviews = true }
        if let data = try? JSONEncoder().encode(settings) { UserDefaults.standard.set(data, forKey: "stati.ipad.reader." + NativeReview.userID) }
    }
    private static var stopReviewPosition: JSONValue = .null
    private static var stopReviewDeadline: Date?
    static func stopReview(_ request: URLRequest) -> (status: Int, body: JSONValue)? {
        guard NativeReview.route == "ipad-stop-leading", request.url?.path.contains("/worship-live/") == true else { return nil }
        if request.httpMethod == "PUT", let data = NativeMarkupServer.requestBody(request),
           let value = try? JSONDecoder().decode(JSONValue.self, from: data) {
            stopReviewPosition = value
            stopReviewDeadline = nil
        } else if request.httpMethod == "DELETE" {
            stopReviewDeadline = .now.addingTimeInterval(7)
        } else if request.httpMethod == "GET" {
            let stopped = stopReviewDeadline.map { $0 <= .now } ?? false
            if stopReviewPosition != .null, !stopped {
                return (200, .object(["state": .string("live"), "isLeader": .bool(true), "position": stopReviewPosition,
                                      "songTitle": .string("Amazing Grace")]))
            }
            return (200, .object(["state": .string("idle")]))
        }
        return (200, .object(["ok": .bool(true)]))
    }
    static func response(_ request: URLRequest) -> JSONValue? {
        guard NativeReview.route != nil, request.httpMethod == "GET", let path = request.url?.path else { return nil }
        if NativeReview.route == "ipad-live-follow" {
            let itemID = "87130dc6-42f2-4872-a1aa-f2e51623f8cf"
            let serviceID = NativeReview.plan["id"].text
            if path.hasSuffix("/services") {
                var plan = NativeReview.plan.fields
                var item = NativeReview.plan["songs"].items[0].fields
                item["id"] = .string(itemID)
                plan["songs"] = .array([.object(item)])
                plan["active"] = .bool(true)
                return .object(["plans": .array([.object(plan)])])
            }
            if path.hasSuffix("/songs/" + NativeReview.songID) {
                var song = NativeReview.song.fields
                song["text"] = .string((1...90).map { "Sample line \($0) for the live reader preview" }.joined(separator: "\n"))
                return .object(song)
            }
            if path.contains("/worship-live/") {
                let elapsed = Date.now.timeIntervalSince(followStarted)
                return .object(["state": .string("live"), "isLeader": .bool(false), "position": .object([
                    "serviceId": .string(serviceID), "sessionId": .string("6b615af0-4355-4f3b-9a78-b6042a4784ab"),
                    "itemId": .string(itemID), "page": .number(elapsed < 5 ? 0 : 1),
                    "mode": .string("document"), "transition": .string("pageTurn"), "columns": .number(1), "slideSize": .number(2),
                ])])
            }
        }
        if NativeReview.route == "ipad-live-activity", path == "/api/computers/" + NativeReview.computerID + "/live-song" {
            return .object(["live": .object([
                "serviceId": NativeReview.plan["id"], "serviceTitle": NativeReview.plan["title"],
                "songId": .string(NativeReview.songID), "songTitle": NativeReview.song["title"],
                "expiresAt": .number(Date.now.timeIntervalSince1970 + 60),
            ])])
        }
        if path == "/api/worship-groups", NativeReview.route == "ipad-group-switcher" {
            var second = group.fields
            second["id"] = .string("a3333333-3333-4333-8333-333333333333")
            second["name"] = .string("Choir")
            return .object(["groups": .array([group, .object(second)]), "canCreate": .bool(true), "nextCursor": .null])
        }
        if path == "/api/worship-groups" { return .object(["groups": .array(emptyGroups ? [] : [group]), "canCreate": .bool(!emptyGroups), "nextCursor": .null]) }
        if path == "/api/worship-groups/candidates" { return .object(["members": .array(members), "nextCursor": .null]) }
        if path == "/api/worship-groups/" + groupID { return .object(["group": group]) }
        return nil
    }
}
#endif
