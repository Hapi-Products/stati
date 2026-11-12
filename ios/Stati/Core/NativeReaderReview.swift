#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor enum NativeReaderReview {
    static var active: Bool { NativeReview.route?.hasPrefix("reader-") == true && NativeReview.route != "reader-check" }
    static var request: SongGalleryRequest? {
        let songs = NativeReviewIPad.songs.map { APIRecord(raw: $0.fields) }
        let selected = ["reader-notes", "reader-unlink"].contains(NativeReview.route ?? "") ? songs[0].id : NativeReview.route == "reader-last" ? songs.last!.id : songs[1].id
        return SongGalleryRequest(computerID: NativeReview.computerID, songs: songs, selectedID: selected)
    }
    private static var placementPlan: APIRecord = {
        var plan = APIRecord(raw: NativeReview.plan.fields)
        plan["songs"] = .array(NativeReviewIPad.songs.prefix(3).enumerated().map { offset, song in
            .object([
                "id": .string("sample-appearance-\(offset)"), "songId": song["id"], "title": song["title"],
                "filename": song["filename"], "contentHash": song["contentHash"], "reviewed": .bool(false)
            ])
        })
        return plan
    }()

    static func placementResponse(_ request: URLRequest) -> (status: Int, body: JSONValue)? {
        guard NativeReview.route == "reader-place-song", request.url?.path.hasSuffix("/services") == true else { return nil }
        if request.httpMethod == "POST" {
            guard let data = NativeMarkupServer.requestBody(request),
                  let payload = try? JSONDecoder().decode(JSONValue.self, from: data),
                  payload["id"].text == placementPlan.id,
                  payload["plan"]["revision"] == placementPlan["revision"] else {
                return (409, .object(["error": .string("The simulator service changed.")]))
            }
            let songs = payload["plan"]["songs"].records
            guard songs.count == 4, songs.filter({ UUID(uuidString: $0.id) != nil }).count == 1,
                  songs.filter({ UUID(uuidString: $0.id) == nil }).map(\.id) == placementPlan["songs"].records.map(\.id) else {
                return (400, .object(["error": .string("The simulator running order is invalid.")]))
            }
            placementPlan["songs"] = payload["plan"]["songs"]
            placementPlan["revision"] = .number(2)
            let position = songs.firstIndex(where: { UUID(uuidString: $0.id) != nil }) ?? -1
            print("STATI_SERVICE_PLACEMENT: saved at position \(position + 1) of \(songs.count)")
        }
        return (200, .object(["plans": .array([placementPlan.value])]))
    }

    static func response(_ request: URLRequest) -> JSONValue? {
        guard active, request.httpMethod == "GET", let url = request.url else { return nil }
        if NativeReview.route == "reader-unavailable", url.path.contains("/songs/") { return .object(["error": .string("Labelled unavailable-song fixture")]) }
        if url.path.contains("/songs/"), let song = NativeReviewIPad.songs.first(where: { url.path.hasSuffix("/songs/" + $0["id"].text) }) {
            var value = song.fields
            value["text"] = .string(song["text"].text + "\n\nSample second verse\nFor simulator review only\nWithin this song\nNo next-song navigation\n\nSample final verse\nFor simulator review only\nLast page of this song")
            if NativeReview.route == "reader-document-columns" {
                value["text"] = .string((1...120).map { "Sample lyric line \($0)" }.joined(separator: "\n"))
            }
            if NativeReview.route == "reader-page-thumbnails" {
                let verses = (1...12).map { page in
                    (1...(page == 1 ? 14 : 4)).map { "Sample slide \(page), line \($0)" }.joined(separator: "\n")
                }
                value["text"] = .string(verses.joined(separator: "\n\n"))
            }
            return .object(value)
        }
        if url.path == "/api/group-materials" {
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let id = query.first { $0.name == "songId" }?.value ?? ""
            return .object(["materials": .array(id == NativeReview.songID ? [NativeReviewMaterial.file] : []), "nextCursor": .null,
                            "linkContext": .object(["computerId": .string(NativeReview.computerID), "songId": .string(id)])])
        }
        return nil
    }
}
#endif
