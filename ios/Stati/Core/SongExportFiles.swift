import Foundation

@MainActor enum SongExportFiles {
    static func prepare(song: APIRecord, computerID: String, kind: SongExportKind, store: AppStore) async throws -> URL {
        let owner = store.me?.id, epoch = store.accountEpoch
        guard owner != nil, store.api.signedIn else { throw CancellationError() }
        await Task.yield()
        let data: Data
        switch kind {
        case .documentPDF: data = try SongDocumentRenderer.document(text: song["text"].text, columns: ReaderPreferences(ownerID: owner ?? "").settings.pdfColumns)
        case .slidePDF: data = try SongDocumentRenderer.slides(pages: SongPages(text: song["text"].text).pages)
        case .powerPoint: data = try await store.api.bytes("/computers/" + computerID + "/songs/" + song.id + "/export?format=pptx&contentHash=" + song["contentHash"].text.queryEncoded)
        }
        try Task.checkCancellation()
        guard store.me?.id == owner, store.accountEpoch == epoch, store.api.signedIn else { throw CancellationError() }
        let directory = URL.temporaryDirectory.appending(path: "StatiSongExports", directoryHint: .isDirectory).appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let invalid = CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)
        let name = String(song.title.unicodeScalars.map { invalid.contains($0) ? "_" : String($0) }.joined().prefix(100)).trimmingCharacters(in: .whitespacesAndNewlines)
        let suffix = kind == .powerPoint ? ".pptx" : kind == .slidePDF ? " — Slides.pdf" : ".pdf"
        let file = directory.appending(path: (name.isEmpty ? "Song" : name) + suffix)
        do { try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]); return file }
        catch { try? FileManager.default.removeItem(at: directory); throw error }
    }
    static func remove(_ file: URL) {
        let parent = file.deletingLastPathComponent(), root = URL.temporaryDirectory.appending(path: "StatiSongExports", directoryHint: .isDirectory)
        guard UUID(uuidString: parent.lastPathComponent) != nil, parent.deletingLastPathComponent().standardizedFileURL == root.standardizedFileURL else { return }
        try? FileManager.default.removeItem(at: parent)
    }
}
