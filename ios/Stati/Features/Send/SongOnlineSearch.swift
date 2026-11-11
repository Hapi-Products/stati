import SwiftUI

private enum Hymnary {
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

    private static let base = URL(string: "https://hymnary.org")!

    static func search(_ input: String, lyrics: Bool) async throws -> [Hymn] {
        let words = input.prefix(160).components(separatedBy: CharacterSet.alphanumerics.union(.nonBaseCharacters).inverted)
            .filter { !$0.isEmpty }.joined(separator: " ")
        guard !words.isEmpty else { return [] }
        let field = lyrics ? "fullText" : "textName"
        let url = base.appending(path: "search").appending(queryItems: [
            URLQueryItem(name: "qu", value: "\(field):\"\(words)\" in:texts"),
            URLQueryItem(name: "export", value: "csv")
        ])
        let bytes = try await data(url)
        guard let csv = String(data: bytes, encoding: .utf8) else { throw unavailable }
        let rows = parseCSV(csv)
        guard let header = rows.first,
              let id = header.firstIndex(of: "textAuthNumber"),
              let title = header.firstIndex(of: "displayTitle"),
              let firstLine = header.firstIndex(of: "firstLine") else { throw unavailable }
        var seen: Set<String> = []
        return Array(rows.dropFirst().lazy.compactMap { row -> Hymn? in
            guard row.count > max(id, title, firstLine), !row[title].isEmpty,
                  row[id].range(of: #"^[a-zA-Z0-9_-]{1,150}$"#, options: .regularExpression) != nil,
                  seen.insert(row[id]).inserted else { return nil }
            return Hymn(id: row[id], title: row[title], firstLine: row[firstLine])
        }.prefix(15))
    }

    static func versions(_ hymn: Hymn) async throws -> [Version] {
        let result = try await data(base.appending(path: "api/fulltext/" + hymn.id))
        let versions = try JSONDecoder().decode([Version].self, from: result)
        var seen: Set<String> = []
        return Array(versions.lazy.filter {
            $0.displayPermissions == "all" && !$0.lyrics.isEmpty && $0.lyrics.utf8.count <= 24_000
                && seen.insert($0.lyrics).inserted
        }.prefix(12))
    }

    private static var unavailable: APIError { APIError(status: 502, message: "Hymnary couldn’t return results. Try again.") }

    private static func data(_ url: URL) async throws -> Data {
        var request = URLRequest(url: url)
        request.timeoutInterval = 12
        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.url?.scheme == "https", http.url?.host == base.host,
              http.expectedContentLength <= 750_000 else { throw unavailable }
        var result = Data()
        for try await byte in bytes {
            guard result.count < 750_000 else { throw unavailable }
            result.append(byte)
        }
        return result
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

struct SongOnlineSearch: View {
    let use: (SendDraft) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query: String
    @State private var searchLyrics = false
    @State private var results: [Hymnary.Hymn] = []
    @State private var searched = false
    @State private var loading = false
    @State private var message = ""
    @State private var pending: Task<Void, Never>?

    init(initialQuery: String, use: @escaping (SendDraft) -> Void) {
        _query = State(initialValue: initialQuery)
        self.use = use
    }

    var body: some View {
        NavigationStack {
            List {
                Picker("Search by", selection: $searchLyrics) {
                    Label("Title", systemImage: "music.note").tag(false)
                    Label("Lyrics", systemImage: "text.quote").tag(true)
                }.pickerStyle(.segmented)
                if loading { ProgressView("Searching Hymnary…") }
                if !message.isEmpty { NoticeView(text: message) }
                else if searched && !loading && results.isEmpty { ContentUnavailableView.search(text: query) }
                ForEach(results) { hymn in
                    NavigationLink(value: hymn) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(hymn.title)
                            if !hymn.firstLine.isEmpty && hymn.firstLine != hymn.title {
                                Text(hymn.firstLine).font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Hymnary")
            .searchable(text: $query, prompt: "Hymn title or lyrics")
            .onSubmit(of: .search, search)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }.labelStyle(.iconOnly)
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Search Hymnary", systemImage: "magnifyingglass", action: search)
                        .labelStyle(.iconOnly).disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .navigationDestination(for: Hymnary.Hymn.self) { hymn in HymnVersions(hymn: hymn, use: use) }
        }
        .onDisappear { pending?.cancel() }
    }

    private func search() {
        pending?.cancel()
        let input = query, lyrics = searchLyrics
        loading = true; message = ""; results = []
        pending = Task {
            do {
                let matches = try await Hymnary.search(input, lyrics: lyrics)
                try Task.checkCancellation()
                results = matches
            } catch is CancellationError { return }
            catch {
                guard !Task.isCancelled else { return }
                message = error.localizedDescription
            }
            loading = false; searched = true
        }
    }
}

private struct HymnVersions: View {
    let hymn: Hymnary.Hymn
    let use: (SendDraft) -> Void
    @State private var versions: [Hymnary.Version] = []
    @State private var loading = true
    @State private var message = ""

    var body: some View {
        List {
            if loading { ProgressView("Loading versions…") }
            else if !message.isEmpty { NoticeView(text: message) }
            else if versions.isEmpty { ContentUnavailableView("No text previews available", systemImage: "music.note") }
            ForEach(versions) { version in
                NavigationLink(value: version) {
                    HStack(spacing: 12) {
                        SlidePreview(text: SongPages(text: version.lyrics).slides.first ?? "")
                        VStack(alignment: .leading) {
                            Text(version.title)
                            Text("No. " + version.number).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            Link(destination: hymn.source) { Label("View source on Hymnary", systemImage: "arrow.up.right") }
        }
        .navigationTitle(hymn.title)
        .navigationDestination(for: Hymnary.Version.self) { version in
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(Array(SongPages(text: version.lyrics).slides.enumerated()), id: \.offset) { _, slide in
                        SongSlidePage(text: slide).aspectRatio(16.0 / 9.0, contentMode: .fit)
                    }
                }.padding()
            }
            .navigationTitle(version.title)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Use in song draft", systemImage: "square.and.pencil") {
                        use(SendDraft(title: hymn.title, text: version.lyrics))
                    }.labelStyle(.iconOnly)
                }
            }
        }
        .task {
            do { versions = try await Hymnary.versions(hymn) }
            catch is CancellationError { return }
            catch { message = error.localizedDescription }
            loading = false
        }
    }
}
