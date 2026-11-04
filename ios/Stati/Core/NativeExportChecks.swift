#if DEBUG && targetEnvironment(simulator)
import UIKit
import PDFKit

@MainActor enum NativeExportChecks {
    static func run(store: AppStore) async {
        var checks: [String: Bool] = [:]
        do {
            let text = (1...120).map { "Verse \($0): Împreună cântăm — Harul Tău rămâne." }.joined(separator: "\n")
            let document = try SongDocumentRenderer.document(text: text)
            let pdf = PDFDocument(data: document)
            let extracted = pdf?.string ?? ""
            checks["documentPaginatesAndRetainsEveryLine"] = (pdf?.pageCount ?? 0) > 1 && (1...120).allSatisfy { extracted.contains("Verse \($0):") }
            // PDFKit infers spaces between positioned glyphs differently on iOS and macOS (e.g. T ău).
            // Check glyphs here; the retained PDF is independently extracted and rendered on macOS.
            let glyphs = extracted.filter { !$0.isWhitespace }
            checks["romanianGlyphsSurvivePDFExtraction"] = glyphs.contains("Împreunăcântăm") && glyphs.contains("HarulTăurămâne")
            let shortLines = (1...120).map { "Line \($0)" }.joined(separator: "\n")
            let oneColumn = PDFDocument(data: try SongDocumentRenderer.document(text: shortLines, columns: .one))
            let twoColumn = PDFDocument(data: try SongDocumentRenderer.document(text: shortLines, columns: .two))
            checks["twoColumnsKeepEveryLineAndUseBothColumns"] = (1...120).allSatisfy { (twoColumn?.string ?? "").contains("Line \($0)") } && (twoColumn?.pageCount ?? 999) < (oneColumn?.pageCount ?? 0)
            let source = "Împreună cântăm\nHarul Tău\n\nAnother verse\nWith no added ending"
            let pages = SongPages(text: source)
            let slides = try SongDocumentRenderer.slides(pages: pages.pages)
            let slidePDF = PDFDocument(data: slides)
            checks["slidePDFIsLandscapeAndPreservesStanzaOrder"] = slidePDF?.pageCount == 2 && slidePDF?.page(at: 0)?.string?.contains("Împreună cântăm") == true && slidePDF?.page(at: 1)?.string?.contains("Another verse") == true && slidePDF?.page(at: 0)?.bounds(for: .mediaBox).width == 1024
            checks["exportsNeverAddTitleOrAmen"] = !(slidePDF?.string ?? "").contains("Amen") && pages.source == source
            do { _ = try SongDocumentRenderer.slides(pages: [String(repeating: "Very long text ", count: 10000)]); checks["overfullSlidesFailInsteadOfClipping"] = false } catch { checks["overfullSlidesFailInsteadOfClipping"] = true }
            do { _ = try SongDocumentRenderer.document(text: " \n"); checks["emptyDocumentRejected"] = false } catch { checks["emptyDocumentRejected"] = true }
            let song = APIRecord(raw: ["id": .string(NativeReview.songID), "title": .string("Unsafe / title"), "text": .string(source)])
            let export = try await SongExportFiles.prepare(song: song, computerID: NativeReview.computerID, kind: .slidePDF, store: store)
            checks["protectedExportHasSafeFilename"] = export.lastPathComponent == "Unsafe _ title — Slides.pdf" && FileManager.default.fileExists(atPath: export.path)
            let external = URL.temporaryDirectory.appending(path: "keep-original-" + UUID().uuidString + ".pdf")
            try slides.write(to: external)
            defer { try? FileManager.default.removeItem(at: external) }
            SongExportFiles.remove(external)
            SongExportFiles.remove(export)
            checks["cleanupOnlyRemovesItsOwnExport"] = !FileManager.default.fileExists(atPath: export.path) && FileManager.default.fileExists(atPath: external.path)
            let artifacts = URL.applicationSupportDirectory.appending(path: "native-export-artifacts", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: artifacts, withIntermediateDirectories: true)
            if let twoColumn { try twoColumn.dataRepresentation()?.write(to: artifacts.appending(path: "song-two-columns.pdf"), options: .atomic) }
            try document.write(to: artifacts.appending(path: "song-document.pdf"), options: .atomic)
            try extracted.write(to: artifacts.appending(path: "document-extracted.txt"), atomically: true, encoding: .utf8)
            try slides.write(to: artifacts.appending(path: "song-slides.pdf"), options: .atomic)
        } catch { checks["noUnexpectedError"] = false }
        let report: [String: Any] = ["passed": checks.count == 9 && checks.values.allSatisfy { $0 }, "checks": checks, "scope": "Simulator executes actual UIKit/CoreText PDF renderer and export file I/O; no system Share gesture or physical-device proof"]
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: URL.applicationSupportDirectory.appending(path: "native-export-checks.json"), options: .atomic) }
    }
}
#endif
