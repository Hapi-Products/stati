import Foundation

nonisolated struct ChartChord: Equatable, Sendable {
    static let sharps = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]
    static let flats = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"]
    let root: Int
    let quality: String
    let bass: Int?
    let spelling: String

    init?(_ spelling: String) {
        let pattern = /^([A-G][#♯b♭]?)(?:(m|min|maj|M|dim|aug|sus|add|omit|no|ø|°|Δ|\+|-|\d|\([#♯b♭]?\d+\)|[#♯b♭]\d+)*)(?:\/([A-G][#♯b♭]?))?$/
        guard let match = spelling.wholeMatch(of: pattern), let root = Self.pitch(String(match.1)) else { return nil }
        self.root = root
        self.bass = match.3.flatMap { Self.pitch(String($0)) }
        self.spelling = spelling
        let main = spelling.split(separator: "/")[0]
        self.quality = String(main.dropFirst(match.1.count))
    }

    static func pitch(_ name: String) -> Int? {
        let natural = ["C":0, "D":2, "E":4, "F":5, "G":7, "A":9, "B":11]
        guard let first = name.first, let root = natural[String(first)], name.count <= 2 else { return nil }
        switch name.dropFirst() {
        case "": return root
        case "#", "♯": return wrap(root + 1)
        case "b", "♭": return wrap(root - 1)
        default: return nil
        }
    }

    static func wrap(_ value: Int) -> Int { (value % 12 + 12) % 12 }

    func moved(_ steps: Int, flats preferFlats: Bool) -> String {
        if steps == 0 { return spelling }
        let names = preferFlats ? Self.flats : Self.sharps
        return names[Self.wrap(root + steps)] + quality + (bass.map { "/" + names[Self.wrap($0 + steps)] } ?? "")
    }
}

nonisolated struct ChartLine: Identifiable, Equatable, Sendable {
    struct Chord: Identifiable, Equatable, Sendable {
        var id: Int { column }
        let column: Int
        var value: ChartChord
    }
    let id: Int
    let text: String
    var chords: [Chord]

    static func parse(_ source: String, markedRows: Set<Int> = []) -> [Self] {
        source.components(separatedBy: .newlines).enumerated().map { line, text in
            let words = text.matches(of: /[^\s|]+/)
            let tokens = words.compactMap { word -> Chord? in
                guard let chord = ChartChord(String(word.output)) else { return nil }
                return Chord(column: text.distance(from: text.startIndex, to: word.range.lowerBound), value: chord)
            }
            let distinct = Set(tokens.map(\.value.root)).count
            let looksLikeChords = tokens.count == words.count && !tokens.isEmpty &&
                (distinct > 1 || text.contains("|") || text.contains("  ") || tokens.contains { $0.value.spelling.count > 1 })
            return Self(id: line, text: text, chords: (looksLikeChords || markedRows.contains(line)) && tokens.count == words.count ? tokens : [])
        }
    }
}
