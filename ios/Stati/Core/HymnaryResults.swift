import Foundation

enum HymnaryResults {
    static let base = URL(string: "https://hymnary.org")!
    struct Hymn: Identifiable, Hashable {
        let id: String
        let title: String
        let firstLine: String
        var source: URL { base.appending(path: "text/" + id) }
    }

    struct Version: Decodable, Hashable, Identifiable {
        let title: String
        let hymnalID: String
        let number: String
        let text: String?
        let displayPermissions: String?

        var id: String { hymnalID + ":" + number }
        var lyrics: String {
            (text ?? "").replacingOccurrences(of: "\n\r\n", with: "\n")
                .replacingOccurrences(of: "\r\n", with: "\n")
                .replacingOccurrences(of: "\r", with: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    static func search(_ csv: String) -> [Hymn]? {
        let rows = parseCSV(csv)
        guard let header = rows.first,
              let id = header.firstIndex(of: "textAuthNumber"),
              let title = header.firstIndex(of: "displayTitle"),
              let firstLine = header.firstIndex(of: "firstLine") else { return nil }
        var seen: Set<String> = []
        var hymns: [Hymn] = []
        for row in rows.dropFirst() {
            guard row.count > max(id, title, firstLine), !row[title].isEmpty,
                  row[id].range(of: #"^[a-zA-Z0-9_-]{1,150}$"#, options: .regularExpression) != nil,
                  seen.insert(row[id]).inserted else { continue }
            hymns.append(Hymn(id: row[id], title: row[title], firstLine: row[firstLine]))
            if hymns.count == 15 { break }
        }
        return hymns
    }

    static func versions(_ result: Data) throws -> [Version] {
        let versions = try JSONDecoder().decode([Version].self, from: result)
        var seenLyrics: Set<String> = []
        var previews: [Version] = []
        for version in versions where version.displayPermissions == "all" {
            let lyrics = version.lyrics
            guard !lyrics.isEmpty, lyrics.utf8.count <= 24_000, seenLyrics.insert(lyrics).inserted else { continue }
            previews.append(version)
            if previews.count == 12 { break }
        }
        return previews
    }

    private static func parseCSV(_ text: String) -> [[String]] {
        var rows: [[String]] = [], row: [String] = []
        var field = "", quoted = false, closedQuote = false
        for character in text {
            if character == "\"" {
                if closedQuote { field.append(character); quoted = true; closedQuote = false }
                else if quoted { quoted = false; closedQuote = true }
                else if field.isEmpty { quoted = true }
                else { field.append(character) }
            } else if !quoted && (character == "," || character.isNewline) {
                row.append(field)
                field = ""; closedQuote = false
                if character.isNewline { rows.append(row); row = [] }
            } else {
                field.append(character)
                closedQuote = false
            }
        }
        if !field.isEmpty || !row.isEmpty { rows.append(row + [field]) }
        return rows
    }
}
