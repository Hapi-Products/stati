import Foundation

/// Reading pages derived from one song; the source remains exact for copying/export.
nonisolated struct SongPages: Sendable {
    let source: String
    let pages: [String]
    init(text: String, linesPerSlide: Int = 6) {
        source = text
        let limit = min(12, max(1, linesPerSlide))
        var result: [String] = [], lines: [String] = []
        func flush() {
            while !lines.isEmpty {
                result.append(lines.prefix(limit).joined(separator: "\n"))
                lines.removeFirst(min(limit, lines.count))
            }
        }
        for line in text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").components(separatedBy: "\n") {
            if line.trimmingCharacters(in: .whitespaces).isEmpty { flush() }
            else { lines.append(line) }
        }
        flush(); pages = result
    }
    var position: ReaderPosition? {
        ReaderPosition(ids: pages.indices.map { "page-" + String($0) }, selectedID: "page-0")
    }
    /// A presentation ending, derived without changing lyrics or exported originals.
    var slides: [String] {
        guard let last = pages.last?.components(separatedBy: "\n").last else { return [] }
        let ending = last.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters)).lowercased()
        var slides = pages
        if ["amen", "amin"].contains(ending) {
            // A standalone source ending belongs with the final lyric page.
            if pages.count > 1, pages.last?.components(separatedBy: "\n").count == 1 {
                let ending = slides.removeLast()
                slides[slides.count - 1] += "\n" + ending
            }
        } else { slides[slides.count - 1] += "\nAmen" }
        return slides
    }
}
