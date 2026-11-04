#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor enum NativeReviewIPad {
    static var songs: [JSONValue] {
        if NativeReview.route?.contains("search-ranking") == true {
            return [("a", "A lyric-only match", "Opening line\n\nHoly in a later verse", "Choir"), ("c", "Holy, Holy, Holy", "Holy, holy, holy!", "Choir"), ("d", "Z first-line match", "Holy is the Lord", "Worship group")].map { id, title, text, group in
                var row = NativeReview.song.fields; row["id"] = .string(String(repeating: id, count: 64)); row["title"] = .string(title); row["text"] = .string(text); row["firstSlide"] = .string(text.components(separatedBy: "\n").prefix(2).joined(separator: "\n")); row["groupName"] = .string(group); return .object(row)
            }
        }
        let values = [(String(repeating: "a", count: 64), "Amazing Grace", "Choir", NativeReview.song["text"].text), (String(repeating: "c", count: 64), "Holy, Holy, Holy", "Choir", "Holy, holy, holy!\nLord God Almighty!\nEarly in the morning\nOur song shall rise to Thee"), (String(repeating: "d", count: 64), "Praise to the Lord", "Worship group", "Praise to the Lord, the Almighty\nThe King of creation"), (String(repeating: "e", count: 64), "Joyful, Joyful", "Worship group", "Joyful, joyful, we adore Thee\nGod of glory, Lord of love"), (String(repeating: "f", count: 64), "Doxology", "", "Praise God, from whom all blessings flow\nPraise Him, all creatures here below")]
        return values.map { id, title, group, text in var row = NativeReview.song.fields; row["id"] = .string(id); row["title"] = .string(title); row["groupName"] = group.isEmpty ? .null : .string(group); row["text"] = .string(text); row["firstSlide"] = .string(text.components(separatedBy: "\n").prefix(2).joined(separator: "\n")); return .object(row) }
    }
    static var tasks: [JSONValue] {
        let values = [(NativeReview.task["id"].text, "Check the choir microphone", "Test the sound before the evening service.", "new", 2), ("cb1e63b6-80e4-448a-a3ec-1cb61a129143", "Add the guitar notes", "Link the chord sheet to Praise to the Lord.", "new", 0), ("cb1e63b6-80e4-448a-a3ec-1cb61a129144", "Review Sunday’s running order", "Confirm the final verse with the worship leader.", "in-progress", 1), ("cb1e63b6-80e4-448a-a3ec-1cb61a129145", "Replace the spare cable", "A new cable is beside the sound desk.", "complete", 0)]
        return values.map { id, title, body, status, count in var row = NativeReview.task.fields; row["id"] = .string(id); row["title"] = .string(title); row["body"] = .string(body); row["status"] = .string(status); row["noteCount"] = .number(Double(count)); if ["ipad-member", "ipad-shared-member", "ipad-groups-none", "ipad-original"].contains(NativeReview.route ?? "") { row["canManage"] = .bool(false); row["canDelete"] = .bool(false) }; return .object(row) }
    }
    static func prepareRecents(store: AppStore) async {
        guard NativeReview.route?.hasPrefix("ipad-") == true else { return }
        do {
            let result = try await store.api.request("/computers/" + NativeReview.computerID + "/songs/" + NativeReview.songID)
            store.recents.opened(song: APIRecord(raw: result.fields), computerID: NativeReview.computerID)
            if let file = FilePreviewItem(record: APIRecord(raw: NativeReviewMaterial.file.fields), pathKey: "fileUrl") {
                let temporary = try await NativePreview.download(api: store.api, path: file.path, filename: file.filename)
                defer { NativePreview.remove(temporary) }
                store.recents.opened(file: file)
            }
        } catch { }
    }
    static func response(_ request: URLRequest) -> JSONValue? {
        guard NativeReview.route?.hasPrefix("ipad-") == true || NativeReview.route?.hasPrefix("phone-search") == true || NativeReview.route == "phone-folders", request.httpMethod == "GET", let url = request.url else { return nil }
        let path = url.path, query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ key: String) -> String { query.first(where: { $0.name == key })?.value ?? "" }
        if path == "/api/me" && ["ipad-member", "ipad-shared-member", "ipad-groups-none", "ipad-original"].contains(NativeReview.route ?? "") { var member = NativeReview.person.fields; member["role"] = .string("member"); member["ministryRole"] = .string("worship_member"); member["capabilities"] = .object(["readSongs": .bool(true), "planServices": .bool(false)]); return .object(["user": .object(member)]) }
        if path.hasSuffix("/services"), ["ipad-service", "ipad-service-list", "ipad-service-reader"].contains(NativeReview.route ?? "") {
            var plan = NativeReview.plan.fields
            plan["songs"] = .array(songs.prefix(3).enumerated().map { index, song in .object(["id": .string("appearance" + String(index + 1)), "songId": song["id"], "title": song["title"], "contentHash": song["contentHash"]]) })
            return .object(["plans": .array([.object(plan)])])
        }
        if path.hasSuffix("/songs") {
            let group = value("groupName"), search = value("query")
            let rows = songs.filter { row in (group.isEmpty || group == "__generic__" && row["groupName"].text.isEmpty || group == row["groupName"].text) && (search.isEmpty || row["title"].text.localizedStandardContains(search) || row["text"].text.localizedStandardContains(search)) }
            return .object(["items": .array(rows), "total": .number(Double(rows.count)), "groups": .array([.string("Choir"), .string("Worship group")])])
        }
        if path.contains("/songs/"), let song = songs.first(where: { path.hasSuffix("/songs/" + $0["id"].text) }) { return song }
        if path == "/api/group-materials" {
            let filtered = !value("songId").isEmpty
            let sampleRows = [NativeReviewMaterial.file, NativeReviewMaterial.secondFile].map { item in var row = item.fields; row["groupId"] = .string(NativeReview15.groupID); row["groupName"] = .string("Sunday worship"); return JSONValue.object(row) }
            let rows = filtered ? (value("songId") == NativeReview.songID ? [sampleRows[0]] : []) : sampleRows
            var result: [String: JSONValue] = ["materials": .array(rows), "groups": .array([.string("Choir"), .string("Worship group")]), "canUpload": .bool(!["ipad-member", "ipad-shared-member", "ipad-groups-none", "ipad-original"].contains(NativeReview.route ?? "")), "nextCursor": .null]
            if filtered { result["linkContext"] = .object(["computerId": .string(value("computerId")), "songId": .string(value("songId"))]) }
            return .object(result)
        }
        if path == "/api/tasks" { let rows = NativeReview.route == "ipad-tasks-empty" ? [] : tasks; return .object(["items": .array(rows), "total": .number(Double(rows.count))]) }
        if path.hasPrefix("/api/tasks/"), let task = tasks.first(where: { path == "/api/tasks/" + $0["id"].text }) {
            let notes: [JSONValue] = (0..<Int(task["noteCount"].number)).map { index in .object(["id": .string("sample-note-" + String(index)), "authorName": .string(index == 0 ? "Sample M." : "Sample N."), "body": .string(index == 0 ? "The microphone is ready for a sound check." : "I will check it before rehearsal."), "canDelete": .bool(false)]) }
            return .object(["task": task, "notes": .array(notes), "images": .array(task["id"].text == NativeReview.task["id"].text ? [NativeReviewTaskImage.record(1), NativeReviewTaskImage.record(2)] : [])])
        }
        return nil
    }
}
#endif
