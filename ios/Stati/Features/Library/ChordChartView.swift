import FoundationModels
import SwiftUI

struct ChordChartView: View {
    struct ServiceSong {
        let computer: String
        let service: String
        let item: SongGalleryItem
        var path: String { "/computers/\(computer)/services/\(service)/song-key/\(item.id)" }
    }

    let filename: String
    let source: URL
    let scope: ServiceSong?
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var lines: [ChartLine] = []
    @State private var text = ""
    @State private var original = 0
    @State private var personal: Int?
    @State private var shared: Int?
    @State private var revision = 0
    @State private var canSave = false
    @State private var reading = true
    @State private var editing = false
    @State private var working = false
    @State private var message = ""
    @State private var refresh = 0

    private var key: Int { personal ?? shared ?? original }
    private var steps: Int { ChartChord.wrap(key - original) }
    private var names: [String] { [1, 3, 5, 8, 10].contains(key) ? ChartChord.flats : ChartChord.sharps }
    private var supportsSuggestions: Bool {
        if case .available = SystemLanguageModel.default.availability { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            Group {
                if reading {
                    ProgressView("Reading chord sheet…")
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 18) {
                            controls
                            if !message.isEmpty {
                                Text(message).font(.footnote).foregroundStyle(.secondary)
                            }
                            if lines.allSatisfy({ $0.chords.isEmpty }) {
                                ContentUnavailableView("No chords detected", systemImage: "music.note",
                                                       description: Text("Use the pencil to review the extracted text. Put chords on their own lines, separated by spaces or bars."))
                            }
                            chart
                        }
                        .frame(maxWidth: 760)
                        .padding(24)
                        .frame(maxWidth: .infinity)
                    }
                }
            }
            .navigationTitle(filename)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }.labelStyle(.iconOnly)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Edit extracted text", systemImage: "pencil") { editing = true }.labelStyle(.iconOnly).disabled(reading || working)
                }
                if supportsSuggestions {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Find chord rows with Apple Intelligence", systemImage: "apple.intelligence") {
                            Task { await suggestRows() }
                        }.labelStyle(.iconOnly).disabled(reading || text.isEmpty || working)
                    }
                }
            }
            .sheet(isPresented: $editing) {
                NavigationStack {
                    TextEditor(text: $text).font(.body.monospaced()).padding()
                        .navigationTitle("Chart Text").navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .confirmationAction) {
                            Button("Apply chart text", systemImage: "checkmark") {
                                lines = ChartLine.parse(text)
                                editing = false
                            }.labelStyle(.iconOnly)
                        } }
                }
            }
        }
        .task { await loadChart() }
        .task(id: "\(store.serviceChangeRevision):\(refresh)") { await loadKey() }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Picker("Original key", selection: $original) {
                    ForEach(0..<12) { pitch in Text(ChartChord.sharps[pitch]).tag(pitch) }
                }
                Spacer()
                Button("Down a semitone", systemImage: "minus") { personal = ChartChord.wrap(key - 1) }.labelStyle(.iconOnly)
                Picker("Key", selection: Binding(get: { key }, set: { personal = $0 })) {
                    ForEach(0..<12) { pitch in Text(names[pitch]).tag(pitch) }
                }
                Button("Up a semitone", systemImage: "plus") { personal = ChartChord.wrap(key + 1) }.labelStyle(.iconOnly)
            }
            if scope != nil {
                HStack {
                    Label(shared.map { "Service key: " + names[$0] } ?? "Service key not set", systemImage: "person.2")
                        .font(.subheadline).foregroundStyle(.secondary)
                    Spacer()
                    if personal != nil {
                        Button("Use service key", systemImage: "arrow.counterclockwise") {
                            personal = nil
                        }.labelStyle(.iconOnly)
                    }
                    if canSave {
                        Menu("Shared key actions", systemImage: "ellipsis.circle") {
                            Button("Save key for everyone", systemImage: "person.2.badge.checkmark") { Task { await saveKey(key) } }
                            if shared != nil {
                                Button("Clear service key", systemImage: "minus.circle", role: .destructive) { Task { await saveKey(nil) } }
                            }
                        }.labelStyle(.iconOnly).disabled(working || reading || lines.allSatisfy { $0.chords.isEmpty })
                    }
                }
            }
        }
    }

    private var chart: some View {
        ScrollView(.horizontal) {
            VStack(alignment: .leading, spacing: 5) {
                ForEach(lines) { line in
                    if line.chords.isEmpty {
                        Text(line.text.isEmpty ? " " : line.text)
                    } else {
                        HStack(spacing: 0) {
                            ForEach(Array(line.chords.enumerated()), id: \.element.id) { index, chord in
                                let previous = index == 0 ? 0 : line.chords[index - 1].column + line.chords[index - 1].value.moved(steps, flats: names == ChartChord.flats).count
                                Text(String(repeating: " ", count: min(100, max(index == 0 ? 0 : 1, chord.column - previous))))
                                chordMenu(line: line.id, chord: chord)
                            }
                        }
                    }
                }
            }
            .font(.body.monospaced())
            .fixedSize(horizontal: true, vertical: false)
        }
        .defaultScrollAnchor(.leading)
    }

    private func chordMenu(line: Int, chord: ChartLine.Chord) -> some View {
        let title = chord.value.moved(steps, flats: names == ChartChord.flats)
        return Menu {
            Picker("Root note", selection: Binding(
                get: { ChartChord.wrap(chord.value.root + steps) },
                set: { root in replace(line: line, chord: chord, root: ChartChord.wrap(root - steps), bass: chord.value.bass) }
            )) {
                ForEach(0..<12) { pitch in Text(names[pitch]).tag(pitch) }
            }
            Picker("Bass note", selection: Binding<Int?>(
                get: { chord.value.bass.map { ChartChord.wrap($0 + steps) } },
                set: { bass in replace(line: line, chord: chord, root: chord.value.root, bass: bass.map { ChartChord.wrap($0 - steps) }) }
            )) {
                Text("Same as root").tag(nil as Int?)
                ForEach(0..<12) { pitch in Text(names[pitch]).tag(Optional(pitch)) }
            }
        } label: {
            Text(title).font(.body.monospaced().bold()).foregroundStyle(AppIconAppearance.shared.accent)
        }
        .accessibilityLabel("Edit chord \(title)")
    }

    private func replace(line: Int, chord: ChartLine.Chord, root: Int, bass: Int?) {
        guard let index = lines[line].chords.firstIndex(where: { $0.id == chord.id }),
              let value = ChartChord(ChartChord.sharps[root] + chord.value.quality + (bass.map { "/" + ChartChord.sharps[$0] } ?? "")) else { return }
        lines[line].chords[index].value = value
    }

    private func loadChart() async {
        defer { reading = false }
        do {
            let data = try Data(contentsOf: source, options: .mappedIfSafe)
            let sourceText = try await ChordChartImport.text(from: data, pdf: source.pathExtension.lowercased() == "pdf")
            try Task.checkCancellation()
            text = String(sourceText.prefix(40_000))
            lines = ChartLine.parse(text)
            let printedKey = text.firstMatch(of: /(?im)^\s*(?:original key|key)\s*:\s*([A-G][#♯b♭]?)/)
            original = printedKey.flatMap { ChartChord.pitch(String($0.1)) }
                ?? lines.lazy.compactMap { $0.chords.first?.value.root }.first ?? 0
        } catch is CancellationError { }
        catch let error as APIError { message = error.localizedDescription }
        catch { message = "Couldn’t read the chart. You can enter or paste the chords with the pencil." }
    }

    private func suggestRows() async {
        working = true
        defer { working = false }
        do {
            let marked = try await ChordChartImport.suggestedRows(text)
            let suggestions = ChartLine.parse(text, markedRows: marked)
            for index in lines.indices where lines[index].chords.isEmpty && suggestions.indices.contains(index) {
                lines[index].chords = suggestions[index].chords
            }
            message = "Review the detected chords against the original file."
        } catch { message = "Apple Intelligence couldn’t find chord rows. You can still edit the chart text." }
    }

    private func loadKey() async {
        guard let scope else { return }
        do {
            let response = try await store.api.request(scope.path)
            try Task.checkCancellation()
            guard response["contentHash"].text == scope.item.contentHash else {
                canSave = false
                shared = nil
                return
            }
            applyKey(response)
        } catch is CancellationError { }
        catch {
            canSave = false
            shared = nil
        }
    }

    private func applyKey(_ response: JSONValue) {
        if case .number(let pitch) = response["pitch"] { shared = Int(exactly: pitch) }
        else { shared = nil }
        revision = Int(exactly: response["revision"].number) ?? 0
        canSave = response["canEdit"].flag
    }

    private func saveKey(_ pitch: Int?) async {
        guard let scope, canSave, !working else { return }
        working = true
        defer { working = false }
        do {
            let response = try await store.api.request(scope.path, method: "PUT", body: .object([
                "pitch": pitch.map { .number(Double($0)) } ?? .null,
                "revision": .number(Double(revision)),
                "contentHash": .string(scope.item.contentHash)
            ]))
            applyKey(response)
            personal = nil
            message = pitch == nil ? "Service key cleared." : "Key saved for this song in the service."
        } catch {
            message = error.localizedDescription
            refresh += 1
        }
    }
}
