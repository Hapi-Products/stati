import Foundation

nonisolated struct SongAlphabet: Identifiable {
    let id: String
    let songs: [APIRecord]
    static func sections(_ songs: [APIRecord]) -> [SongAlphabet] {
        let grouped = Dictionary(grouping: songs) { song in
            let title = song.title.trimmingCharacters(in: .whitespacesAndNewlines).folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX")).uppercased()
            guard let first = title.first, first.isLetter else { return "#" }
            return String(first)
        }
        return grouped.keys.sorted { a, b in a == "#" ? false : b == "#" ? true : a.localizedStandardCompare(b) == .orderedAscending }.map { key in
            SongAlphabet(id: key, songs: (grouped[key] ?? []).sorted { a, b in
                let order = a.title.localizedStandardCompare(b.title)
                return order == .orderedSame ? a.id < b.id : order == .orderedAscending
            })
        }
    }
}
