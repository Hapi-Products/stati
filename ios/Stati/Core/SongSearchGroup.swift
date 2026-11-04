import Foundation

nonisolated struct SongSearchGroup: Identifiable {
    let id: String
    let name: String
    let primaryMatch: Bool
    let songs: [APIRecord]
    var matchLabel: String { primaryMatch ? "Title or first line" : "Other lyrics" }
    static func sections(_ songs: [APIRecord], query: String) -> [SongSearchGroup] {
        let words = normalized(query).split(separator: " ").map(String.init)
        func matches(_ text: String) -> Bool { let value = normalized(text); return !words.isEmpty && words.allSatisfy { value.contains($0) } }
        func primary(_ song: APIRecord) -> Bool {
            let first = song["firstLine"].text.isEmpty ? song["firstSlide"].text.components(separatedBy: .newlines).first ?? "" : song["firstLine"].text
            return matches(song.title) || matches(first)
        }
        return [true, false].flatMap { priority -> [SongSearchGroup] in
            let grouped = Dictionary(grouping: songs.filter { primary($0) == priority }) { song in
                let group = song["groupName"].text
                return group.isEmpty || group == "__generic__" ? "Songs" : group
            }
            return grouped.keys.sorted { $0.localizedStandardCompare($1) == .orderedAscending }.map { name in
                let rows = (grouped[name] ?? []).sorted {
                    let order = $0.title.localizedStandardCompare($1.title)
                    return order == .orderedSame ? $0.id < $1.id : order == .orderedAscending
                }
                return SongSearchGroup(id: (priority ? "primary:" : "lyrics:") + name, name: name, primaryMatch: priority, songs: rows)
            }
        }
    }
    private static func normalized(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX")).components(separatedBy: .alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: " ")
    }
}
