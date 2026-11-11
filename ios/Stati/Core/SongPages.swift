import Foundation

/// Reading pages derived from one song; the source remains exact for copying/export.
nonisolated struct SongPages: Sendable {
    let source: String
    let pages: [String]
    private let stanzas: [String]

    init(text: String, linesPerSlide: Int = 6) {
        source = text
        let limit = min(12, max(1, linesPerSlide))
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n").components(separatedBy: "\n")
        var blocks: [[String]] = []
        var block: [String] = []
        for line in lines {
            if line.trimmingCharacters(in: .whitespaces).isEmpty {
                if !block.isEmpty { blocks.append(block); block = [] }
            } else {
                block.append(line)
            }
        }
        if !block.isEmpty { blocks.append(block) }
        stanzas = blocks.map { $0.joined(separator: "\n") }
        pages = blocks.flatMap { block in
            stride(from: 0, to: block.count, by: limit).map { start in
                block[start..<min(start + limit, block.count)].joined(separator: "\n")
            }
        }
    }
    var position: ReaderPosition? {
        ReaderPosition(ids: pages.indices.map { "page-" + String($0) }, selectedID: "page-0")
    }
    /// A presentation ending, derived without changing lyrics or exported originals.
    var slides: [String] {
        guard let last = stanzas.last?.components(separatedBy: "\n").last else { return [] }
        let ending = last.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters)).lowercased()
        var slides = stanzas
        if ["amen", "amin"].contains(ending) {
            // A standalone source ending belongs with the final lyric page.
            if stanzas.count > 1, stanzas.last?.components(separatedBy: "\n").count == 1 {
                let ending = slides.removeLast()
                slides[slides.count - 1] += "\n" + ending
            }
        } else { slides[slides.count - 1] += "\nAmen" }
        return slides
    }
}
