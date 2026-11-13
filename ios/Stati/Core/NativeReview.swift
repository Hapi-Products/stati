#if DEBUG && targetEnvironment(simulator)
import Foundation
import CryptoKit
import SwiftUI

/// Simulator-only review data. No account, cookie, or production network access.
@MainActor enum NativeReview {
    static var route: String? { let args = ProcessInfo.processInfo.arguments; guard let i = args.firstIndex(of: "--review-screen"), args.indices.contains(i + 1) else { return nil }; return args[i + 1] }
    private static var reviewBuildPause = false
    private static var clickerPage = 0
    private static var clickerTurn: JSONValue = .null
    static let clickerSessionID = "631d4eae-fb26-448f-88e5-76c249650e4a"
    static let computerID = "3ba6dd35-835d-48d7-bfd1-0753c596d8b3"
    static let userID = "eb1e63b6-80e4-448a-a3ec-1cb61a129142"
    static let songID = String(repeating: "a", count: 64)
    static let person: JSONValue = .object(["id": .string(userID), "first_name": .string("Sample"), "last_initial": .string("M"), "status": .string("active"), "role": .string("admin"), "photoUrl": .string("/api/members/" + userID + "/photo"), "capabilities": .object(["readSongs": .bool(true), "planServices": .bool(true)])])
    static var viewer: JSONValue {
        if route == "ipad-blocked-pastor" || route == "ipad-blocked-commenter" {
            var value = person.fields
            value["role"] = .string("member"); value["ministryRole"] = .string(route == "ipad-blocked-pastor" ? "pastor" : "commenter")
            return .object(value)
        }
        if route?.hasPrefix("commenter-") == true {
            var value = person.fields
            value["role"] = .string("member"); value["ministryRole"] = .string("commenter")
            value["capabilities"] = .object(["readSongs": .bool(true), "commentSongs": .bool(true), "sendFiles": .bool(false), "planServices": .bool(false), "editLyrics": .bool(false)])
            return .object(value)
        }
        guard ["team-member", "team-leader", "account-member", "computers-member", "send-build-pause-member"].contains(route ?? "") else { return person }
        var value = person.fields; value["role"] = .string("member")
        if route == "team-leader" { value["ministryRole"] = .string("worship_leader") }
        return .object(value)
    }
    static let song: JSONValue = .object(["id": .string(songID), "contentHash": .string(String(repeating: "b", count: 64)), "title": .string("Amazing Grace"), "text": .string("Amazing grace, how sweet the sound\nThat saved a wretch like me\nI once was lost, but now am found\nWas blind, but now I see"), "firstSlide": .string("Amazing grace, how sweet the sound\nThat saved a wretch like me"), "filename": .string("Amazing Grace.pro")])
    static let plan: JSONValue = .object(["id": .string("ab1e63b6-80e4-448a-a3ec-1cb61a129142"), "title": .string("Sunday evening"), "date": .string("2026-11-01"), "time": .string("18:00"), "revision": .number(1), "notes": .string("Begin with prayer, then invite the worship group."), "songs": .array([.object(["id": .string("appearance1"), "songId": .string(songID), "title": .string("Amazing Grace"), "contentHash": .string(String(repeating: "b", count: 64))])]), "leadership": .object(["canEdit": .bool(true), "isLeader": .bool(true), "revision": .number(1), "leaderLabel": .string("Sample M.")])])
    static let task: JSONValue = .object(["id": .string("cb1e63b6-80e4-448a-a3ec-1cb61a129142"), "title": .string("Check the choir microphone"), "body": .string("Test the sound before the evening service."), "status": .string("new"), "revision": .number(1), "urgent": .bool(false), "authorName": .string("Sample M."), "authorId": .string(userID), "noteCount": .number(2), "canManage": .bool(true), "canDelete": .bool(true)])
    static func prepareQueue(store: AppStore) {
        guard route != "recovery-check", route != "song-check", route != "workspace-check" else { return }
        do {
            let directory = try UploadFiles.directory(userID: userID)
            for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) { try FileManager.default.removeItem(at: file) }
            store.uploads.reset(); store.uploads.load(userID: userID)
            store.sendDraft = SendDraft()
            if route?.hasPrefix("ipad-") == true { store.taskDrafts = [:]; store.serviceDrafts = [:] }
            if route == "send-recovery" {
                try Data("[unreadable fixture".utf8).write(to: directory.appending(path: "queue.json"))
                store.uploads.reset(); store.uploads.load(userID: userID)
            } else if route == "send-pending" || route == "send-finished" || route == "send-ready" {
                let statuses = route == "send-finished" ? ["queued", "delivered"] : route == "send-ready" ? ["ready"] : ["queued"]
                for status in statuses {
                    let id = UUID().uuidString.lowercased()
                    var job = UploadJob(id: id, userID: userID, deviceID: computerID, filename: status == "queued" ? "Choir lyrics.txt" : "Sunday notes.txt", localFile: directory.appending(path: id + ".upload"), bytes: 25, sha256: String(repeating: "a", count: 64))
                    if status == "ready" {
                        let data = Data("Sample lyrics for review.".utf8)
                        try data.write(to: job.localFile)
                        job = UploadJob(id: id, userID: userID, deviceID: computerID, filename: "Choir lyrics.txt", localFile: job.localFile, bytes: data.count, sha256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined())
                    } else {
                    job.receipt = ["protocol": .string("stati-upload-v1"), "accepted": .bool(true), "id": .string(UUID().uuidString), "intentId": .string(id), "deviceId": .string(computerID), "filename": .string(job.filename), "bytes": .number(25), "sha256": .string(job.sha256), "status": .string(status)]
                    }
                    store.uploads.jobs.append(job)
                }
                try store.uploads.save()
            } else if route == "send-text" { store.sendDraft = SendDraft(title: "Cântare", text: "Harul Tău rămâne mereu\nÎți cântăm cu mulțumire") }
            let commandFile = try SongCommandStorage.file(ownerID: userID)
            if route == "song-recovery" { try Data("[unreadable fixture".utf8).write(to: commandFile) }
            else { try SongCommandStorage.save((route?.hasPrefix("song-") == true && route?.hasPrefix("song-notes") != true) || (route == "requests" || route == "profile-requests") ? [commandFixture] : [], ownerID: userID) }
            store.songCommands.reset(); store.songCommands.load(ownerID: userID)
        } catch { store.uploads.message = "Simulator fixture could not load: " + error.localizedDescription }
    }
    static var commandFixture: SongCommand {
        let missing = route?.hasPrefix("song-missing") == true || route == "requests"
        return SongCommand(id: "ab1e63b6-80e4-448a-a3ec-1cb61a129143", ownerID: userID, computerID: computerID, songID: songID, contentHash: song["contentHash"].text, kind: missing ? .archive : .clone, groupName: missing ? nil : "Choir", songTitle: "Amazing Grace", status: route == "song-applied" || route == "song-missing-applied" || route == "requests" ? .applied : route == "song-failed" ? .failed : route == "song-pending" || route == "song-missing-pending" ? .pending : .unconfirmed)
    }
    static var avatarData: Data {
        let renderer = ImageRenderer(content: ZStack { Circle().fill(Color("ActionFill")); Text("S").font(.system(size: 44, weight: .bold)).foregroundStyle(.white) }.frame(width: 80, height: 80))
        renderer.scale = 2
        return renderer.uiImage!.pngData()!
    }
    static func buildPauseResponse(_ request: URLRequest) -> (status: Int, body: JSONValue)? {
        guard route == "send-build-pause", request.url?.path == "/api/admin/build-pause" else { return nil }
        if request.httpMethod == "PUT" {
            guard let data = NativeMarkupServer.requestBody(request), let body = try? JSONDecoder().decode(JSONValue.self, from: data),
                  case let .bool(paused) = body["paused"] else { return (400, .object(["error": .string("Invalid pause.")])); }
            reviewBuildPause = paused
        }
        return (200, .object(["manualPaused": .bool(reviewBuildPause), "activeService": .bool(false), "scheduledUntil": .null]))
    }
    static func clickerResponse(_ request: URLRequest) -> (status: Int, body: JSONValue)? {
        guard route == "phone-live-clicker", request.url?.path == "/api/computers/" + computerID + "/live-clicker" else { return nil }
        if request.httpMethod == "POST" {
            guard let data = NativeMarkupServer.requestBody(request), let input = try? JSONDecoder().decode(JSONValue.self, from: data),
                  input["page"].number == Double(clickerPage), input["turn"] == clickerTurn,
                  let direction = Int(exactly: input["direction"].number), (0..<5).contains(clickerPage + direction) else {
                return (409, .object(["error": .string("The live page changed.")]))
            }
            clickerPage += direction
            clickerTurn = .string(UUID().uuidString.lowercased())
        }
        let position: JSONValue = .object(["sessionId": .string(clickerSessionID), "serviceId": plan["id"],
                                          "itemId": .string("11d5bc1f-fe6d-4661-8cd8-f3a9569c89c5"),
                                          "sequence": .number(1), "page": .number(Double(clickerPage)),
                                          "pageCount": .number(5), "clickerTurn": clickerTurn])
        if request.httpMethod == "POST" { return (200, .object(["position": position])) }
        return (200, .object(["live": .object(["position": position, "songTitle": .string("Amazing Grace"),
                                               "serviceTitle": .string("Sunday evening")])]))
    }
    static func response(_ request: URLRequest) -> JSONValue {
        if request.url?.path == "/api/recents/availability", let data = request.httpBody, let body = try? JSONDecoder().decode(JSONValue.self, from: data) {
            let ids = body["items"].items.map { $0["id"] }
            return .object(["checkedIds": .array(ids), "availableIds": .array(ids)])
        }
        guard request.httpMethod == "GET" else { return .object(["error": .string("Simulator review only. Changes are disabled.")]) }
        if let comment = NativeCommenterReview.response(request) { return comment }
        if let groups = NativeReview15.response(request) { return groups }
        if let reader = NativeReaderReview.response(request) { return reader }
        if let ipad = NativeReviewIPad.response(request) { return ipad }
        let p = request.url!.path
        if NativeReview.route == "scan-check", p == "/api/group-materials" { return NativeScanChecks.materialList }
        if p.hasPrefix("/api/file-edits/") {
            let data = p.contains("/task/") ? NativeReviewTaskImage.png : NativeReviewMaterial.pdf
            return .object(["canEdit": .bool(route != "task-readonly" && route != "ipad-shared-member"), "file": .object(["sha256": .string(FileMarkupStorage.digest(data))]), "edit": .null])
        }
        if p.hasSuffix("/enrollment-code"), route == "computers-invite" {
            return .object(["code": .string("123456"), "url": .string("https://stati.ciani01.org/#join=123456"), "expiresAt": .number(Date.now.timeIntervalSince1970 + 30), "serverTime": .number(Date.now.timeIntervalSince1970)])
        }
        if p == "/api/me" { return .object(["user": viewer]) }
        if p == "/api/devices", route == "send-computer-menu" {
            return .array([
                .object(["id": .string(computerID), "name": .string("Sanctuary PC")]),
                .object(["id": .string("a3333333-3333-4333-8333-333333333333"), "name": .string("Choir Room PC")])
            ])
        }
        if p == "/api/devices" && route == "computers-empty" { return .array([]) }
        if p == "/api/devices" { return .array([.object(["id": .string(computerID), "name": .string("Sanctuary PC")])]) }
        if p == "/api/receivers" { return .array([.object(["id": .string(computerID), "name": .string("Sanctuary PC"), "online": .bool(true)])]) }
        if p == "/api/group-materials", route?.hasPrefix("song-notes") == true {
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let filtered = query.contains(where: { $0.name == "songId" })
            let files: [JSONValue] = route == "song-notes-empty" && filtered ? [] : route == "song-notes-multiple" || !filtered ? [NativeReviewMaterial.file, NativeReviewMaterial.secondFile] : [NativeReviewMaterial.file]
            var value: [String: JSONValue] = ["materials": .array(files), "nextCursor": .null, "canUpload": .bool(true)]
            if filtered && route != "song-notes-oldserver" { value["linkContext"] = .object(["computerId": .string(computerID), "songId": .string(songID)]) }
            return .object(value)
        }
        if p == "/api/group-materials" {
            let old = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "before" }) == true
            let row: JSONValue = .object(["id": .string(old ? "7ba6dd35-835d-48d7-bfd1-0753c596d8b3" : "4ba6dd35-835d-48d7-bfd1-0753c596d8b3"), "title": .string(old ? "Sunday choir notes" : "Amazing Grace · Chord sheet"), "groupName": .string("Choir"), "filename": .string("Choir.pdf"), "fileUrl": .string("/api/group-materials/sample/file"), "authorName": .string("Sample M."), "canDelete": .bool(true)])
            return .object(["materials": .array([row]), "groups": .array([.string("Choir")]), "canUpload": .bool(true), "nextCursor": old ? .null : .string("1793180000:4ba6dd35-835d-48d7-bfd1-0753c596d8b3")])
        }
        if p == "/api/transfers" { return .array([]) }
        if p == "/api/members" {
            let samples = [("p", "P", "pastor"), ("r", "R", "worship_leader"), ("j", "J", "choir_director"), ("n", "N", "worship_member")]
            return .array([viewer] + samples.map { id, initial, role in
                var member = person.fields
                member["id"] = .string("sample-" + id); member["first_name"] = .string("Sample"); member["last_initial"] = .string(initial); member["role"] = .string("member"); member["ministryRole"] = .string(role); member["status"] = .string(id == "n" ? "pending" : "active")
                return .object(member)
            })
        }
        if p.hasSuffix("/songs/" + songID) { return song }
        if p.hasSuffix("/song-commands") {
            let command = commandFixture
            let receipt: JSONValue = .object(["id": .string(command.id), "songId": .string(command.songID), "contentHash": .string(command.contentHash), "kind": .string(command.kind.rawValue), "groupName": command.groupName.map(JSONValue.string) ?? .null, "status": .string(command.status.rawValue)])
            return .object(["commands": .array(command.status == .unconfirmed ? [] : [receipt])])
        }
        if p.hasSuffix("/songs") { return .object(["items": .array([song]), "total": .number(1), "groups": .array([.string("Choir")])]) }
        if p.hasSuffix("/services") { return .object(["plans": .array([plan])]) }
        if p == "/api/tasks" && route == "tasks-empty" { return .object(["items": .array([]), "total": .number(0)]) }
        if p == "/api/tasks" { return .object(["items": .array([task]), "total": .number(1)]) }
        if p.hasPrefix("/api/tasks/") {
            var displayedTask = task.fields
            if route == "task-readonly" { displayedTask["canManage"] = .bool(false); displayedTask["canDelete"] = .bool(false) }
            let taskImages: [JSONValue] = route == "task-noimages" ? [] : route?.hasPrefix("task-gallery") == true ? (1...3).map { NativeReviewTaskImage.record($0) } : [NativeReviewTaskImage.record]
            return .object(["task": .object(displayedTask), "notes": .array([.object(["id": .string("note1"), "authorName": .string("Sample M."), "body": .string("The spare cable is beside the desk."), "canDelete": .bool(true)]), .object(["id": .string("note2"), "authorName": .string("Sample member"), "body": .string("I can check this before rehearsal."), "canDelete": .bool(false)])]), "images": .array(taskImages)]) }
        return .object([:])
    }
}
nonisolated final class NativeReviewProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Task { @MainActor in
            if NativeSendNetworkCheck.losesUploadResponse(request) {
                client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost))
                return
            }
            if let result = NativeSendNetworkCheck.response(request) ?? NativeReaderReview.placementResponse(request) ??
                NativeReview.buildPauseResponse(request) ?? NativeReview.clickerResponse(request) {
                let response = HTTPURLResponse(url: request.url!, statusCode: result.status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                if let data = try? JSONEncoder().encode(result.body) { client?.urlProtocol(self, didLoad: data) }
                client?.urlProtocolDidFinishLoading(self)
                return
            }
            if NativeReview.route == "file-check" { try? await Task.sleep(for: .milliseconds(100)) }
            if NativeReview.route == "markup-check", request.url?.path.hasPrefix("/api/file-edits/") == true {
                let result = NativeMarkupServer.respond(request)
                let response = HTTPURLResponse(url: request.url!, statusCode: result.status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: try! JSONEncoder().encode(result.body)); client?.urlProtocolDidFinishLoading(self)
                return
            }
            let isPhoto = request.url?.path.hasSuffix("/photo") == true
            let isTaskImage = request.url?.path.hasPrefix("/api/tasks/") == true && request.url?.path.contains("/images/") == true
            let isNotes = request.url?.path.hasPrefix("/api/group-materials/") == true && request.url?.path.hasSuffix("/file") == true
            if NativeReview.route == "scan-check", request.url?.path.hasPrefix("/api/group-materials") == true { NativeScanChecks.methods.append(request.httpMethod ?? "GET") }
            let data = NativeReview.route == "scan-check" && isNotes ? (NativeScanChecks.wrongBytes ? Data("mismatched sample".utf8) : NativeScanChecks.pdf) : isPhoto ? NativeReview.avatarData : isTaskImage ? NativeReviewTaskImage.png : isNotes ? NativeReviewMaterial.pdf : try! JSONEncoder().encode(NativeReview.response(request))
            let failedTaskImage = isTaskImage && NativeReview.route == "task-image-error"
            let missingSong = NativeReview.route?.hasPrefix("song-missing") == true && request.url?.path.hasSuffix("/songs/" + NativeReview.songID) == true
            let response = HTTPURLResponse(url: request.url!, statusCode: request.httpMethod == "GET" ? (missingSong ? 404 : failedTaskImage ? 503 : 200) : 403, httpVersion: nil, headerFields: ["Content-Type": isPhoto || isTaskImage ? "image/png" : isNotes ? "application/pdf" : "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() { }
}
#endif
