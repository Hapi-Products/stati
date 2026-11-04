import SwiftUI

@MainActor @Observable final class SongCorrectionModel {
    private(set) var draft: SongCorrectionDraft
    private(set) var busy = false
    private(set) var readable = true
    private(set) var message = ""
    private let store: AppStore
    private let ownerID: String
    private let epoch: UUID
    private let currentSong: APIRecord
    private var selectionCaptureID: String?
    @ObservationIgnored private var storage: SongCorrectionStorage?
    private let request: @MainActor (String, String, JSONValue?) async throws -> JSONValue
    private let upload: @MainActor (String, Data, [String: String]) async throws -> JSONValue
    private var active: Bool { store.me?.id == ownerID && store.accountEpoch == epoch && store.api.signedIn && store.selectedComputer == draft.computerID }
    init(store: AppStore, computerID: String, song: APIRecord, request: (@MainActor (String, String, JSONValue?) async throws -> JSONValue)? = nil, upload: (@MainActor (String, Data, [String: String]) async throws -> JSONValue)? = nil, storageRoot: URL? = nil) {
        self.store = store; ownerID = store.me?.id ?? ""; epoch = store.accountEpoch; currentSong = song
        self.request = request ?? { try await store.api.request($0, method: $1, body: $2) }
        self.upload = upload ?? { path, bytes, headers in try JSONDecoder().decode(JSONValue.self, from: await store.api.bytes(path, method: "PUT", body: bytes, headers: headers)) }
        draft = SongCorrectionDraft(ownerID: ownerID, computerID: computerID, song: song)
        do { let saved = try SongCorrectionStorage(ownerID: ownerID, computerID: computerID, songID: song.id, root: storageRoot); storage = saved; if let previous = try saved.load() { draft = previous; if previous.phase == .sent { message = "Sent for review." } } }
        catch { storage = nil; readable = false; message = "Your saved comment could not be read. Its existing files have been kept." }
        if readable { draft.migrateEditableSelection() }
    }
    var editable: Bool { active && readable && !busy && draft.phase == .editing }
    var canSend: Bool { active && readable && !busy && draft.phase != .sent && draft.phase != .rejected && (draft.phase != .editing || !draft.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
    var comment: String { get { draft.message } set { guard editable else { return }; draft.message = newValue; persist() } }
    var quote: String { get { draft.quote } set { guard editable else { return }; draft.quote = String(newValue.prefix(1000)); persist() } }
    var replacement: String { get { draft.replacement } set { guard editable else { return }; draft.replacement = newValue; persist() } }
    func selectPassage(_ range: NSRange, editing id: String? = nil) {
        guard editable else { return }
        let source = draft.song["text"].text
        guard range.location != NSNotFound, range.location >= 0, range.length > 0, range.length <= 1000,
              let selected = Range(range, in: source) else { message = "Select up to 1,000 characters from the song."; return }
        let quote = String(source[selected])
        if let same = draft.edits.first(where: { $0.range == range }), id == nil { selectionCaptureID = same.id; return }
        let continuing = id ?? draft.edits.first(where: { $0.id == selectionCaptureID && NSIntersectionRange($0.range, range).length > 0 })?.id
        if let continuing, let index = draft.edits.firstIndex(where: { $0.id == continuing }) {
            draft.edits[index].location = range.location; draft.edits[index].length = range.length; draft.edits[index].quote = quote
            selectionCaptureID = continuing
        } else {
            guard draft.edits.count < 10 else { message = "Use up to 10 selected passages in one comment."; return }
            let edit = SongCorrectionEdit(id: UUID().uuidString.lowercased(), location: range.location, length: range.length, quote: quote, replacement: "")
            draft.edits.append(edit); selectionCaptureID = edit.id
        }
        persist()
    }
    func replacePassage(_ id: String, with text: String) {
        guard editable, let index = draft.edits.firstIndex(where: { $0.id == id }) else { return }
        draft.edits[index].replacement = text; persist()
    }
    func removePassage(_ id: String) { guard editable else { return }; draft.edits.removeAll { $0.id == id }; if selectionCaptureID == id { selectionCaptureID = nil }; persist() }
    private func persist() { guard active, readable, let storage else { return }; do { try storage.save(draft); message = "" } catch { message = "Your comment could not be saved on this device. Keep it open and retry." } }
    func photoFailed() { if active { message = "This photo could not be read. Choose it again or select another image." } }
    func imageURL(_ image: SongCorrectionImage) -> URL? { try? storage?.imageFile(image) }
    func addImage(_ data: Data) async {
        guard editable, draft.images.count < 6, let storage else { return }; busy = true; defer { busy = false }
        do {
            let prepared = try await UploadFiles.photo(data: data); defer { try? FileManager.default.removeItem(at: prepared) }
            guard active else { return }; let data = try Data(contentsOf: prepared); guard data.count <= 8 * 1024 * 1024 else { throw APIError(status: 413, message: "Choose an image up to 8 MB.") }; let image = try storage.stage(data); draft.images.append(image); try storage.save(draft); message = ""
        } catch { if active { message = "Image not added. " + error.localizedDescription } }
    }
    func removeImage(_ id: String) { guard editable else { return }; draft.images.removeAll { $0.id == id }; persist() }
    func startNew() {
        guard active, readable, !busy, [.editing,.sent,.rejected].contains(draft.phase), let storage else { return }
        do { try storage.archive(draft); draft = SongCorrectionDraft(ownerID: ownerID, computerID: draft.computerID, song: currentSong); try storage.save(draft); message = "" } catch { message = "Your previous comment is kept. A new draft could not be saved." }
    }
    func reconcile() async {
        guard active, readable, !busy, [.unconfirmed,.accepted].contains(draft.phase) else { return }
        do {
            let value = try await request("/song-comments/" + draft.id, "GET", nil)
            guard active, draft.accepts(value), let storage else { return }
            draft.phase = .accepted; try storage.save(draft); message = "Comment saved. Tap Send to finish any waiting images."
        } catch { if active, (error as? APIError)?.status != 404 { message = error.localizedDescription + " Your saved comment is kept." } }
    }
    func send() async {
        guard canSend, let storage else { return }; busy = true; defer { busy = false }
        var rejected = false
        do {
            if draft.phase == .editing {
                guard !draft.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, draft.message.utf16.count <= 2000, draft.quote.utf16.count <= 1000, draft.replacement.utf16.count <= 1000, draft.replacement.isEmpty || !draft.quote.isEmpty else { throw APIError(status: 400, message: "Write a comment up to 2,000 characters. Select lyrics before suggesting a correction, using up to 1,000 characters in each field.") }
                guard !draft.exceedsReviewTextLimit else { throw APIError(status: 400, message: "Keep the comment, selected lyrics and suggestions together within 4,000 characters. Split longer corrections into another comment.") }
                try draft.freeze()
            }
            try storage.save(draft) // Persist identity and exact content before any network write.
            let receipt: JSONValue
            do { receipt = try await request("/song-comments/" + draft.id, "GET", nil) }
            catch let error as APIError where error.status == 404 {
                guard active else { return }
                guard draft.phase == .unconfirmed else { throw APIError(status: 404, message: "The saved comment is unavailable. Its local copy is kept; it has not been sent again.") }
                do { receipt = try await request("/computers/" + draft.computerID + "/song-comments", "POST", draft.payload) }
                catch { rejected = (error as? APIError).map { [400,403,404,409,413,415].contains($0.status) } ?? false; throw error }
            }
            guard active else { return }
            guard draft.accepts(receipt) else { throw APIError(status: 409, message: "The comment confirmation did not match. Retry checks the same saved comment.") }
            draft.phase = .accepted; try storage.save(draft)
            if !draft.images.isEmpty {
                var images = try await request("/tasks/" + draft.id + "/images", "GET", nil)["images"].items
                guard active else { return }
                for image in draft.images {
                    if let saved = images.first(where: { $0["id"].text == image.id }) {
                        guard image.accepts(saved) else { throw APIError(status: 409, message: "The saved image could not be verified. Its original copy is kept here.") }
                    } else {
                        let bytes = try storage.bytes(image), path = "/tasks/" + draft.id + "/images/" + image.id
                        do {
                            let result = try await upload(path, bytes, ["X-Filename": image.filename, "Content-Type": "image/jpeg", "Content-Length": String(bytes.count)])
                            guard active, image.accepts(result["image"]) else { throw APIError(status: 409, message: "The image upload was not confirmed.") }
                            images.append(result["image"])
                        } catch {
                            guard active else { return }
                            images = try await request("/tasks/" + draft.id + "/images", "GET", nil)["images"].items
                            guard images.contains(where: { image.accepts($0) }) else { throw error }
                        }
                    }
                    guard active else { return }; draft.confirmedImages.insert(image.id); try storage.save(draft)
                }
            }
            guard active else { return }; draft.phase = .sent; try storage.save(draft); try storage.archive(draft)
            message = "Sent for review."; store.tasksInvalidated()
        } catch {
            guard active else { return }
            if rejected { draft.phase = .rejected; try? storage.save(draft) }
            message = error.localizedDescription + " Your saved comment and images are kept."
        }
    }
}
