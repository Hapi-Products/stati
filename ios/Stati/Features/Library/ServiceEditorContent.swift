import SwiftUI

struct ServiceEditorContent: View {
    @Environment(AppStore.self) private var store
    @Bindable var editor: ServiceEditor
    private var iPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }
    private var canEdit: Bool { editor.canEdit && !iPad }
    @State private var readingID: String?
    @State private var adding = false
    @State private var history = false
    @State private var preview: SongGalleryRequest?
    var body: some View {
        List {
            if !editor.message.isEmpty { Section { NoticeView(text: editor.message); if !iPad && editor.failed { Button("Retry saving") { Task { await editor.save() } } } } }
            Section {
                if iPad {
                    Text(editor.title).font(.title2.bold()).textSelection(.enabled)
                    Label(editor.schedule.formatted(date: .abbreviated, time: .shortened), systemImage: "calendar").textSelection(.enabled)
                } else {
                    TextField("Service name", text: $editor.title).disabled(!canEdit)
                    DatePicker("Date", selection: $editor.schedule, displayedComponents: .date).disabled(!canEdit)
                    DatePicker("Time", selection: $editor.schedule, displayedComponents: .hourAndMinute).disabled(!canEdit)
                }
            }
            if !editor.plan["leadership"]["leaderLabel"].text.isEmpty { Text("Service leader: " + editor.plan["leadership"]["leaderLabel"].text).font(.footnote).foregroundStyle(Color.statiSecondary) }
            Section {
                ForEach(editor.songs) { song in
                    Button { readingID = song.id; preview = SongGalleryRequest(computerID: editor.computerID, songs: editor.songs, selectedID: song.id, service: true) }
                    label: {
                        HStack(spacing: 12) {
                            ServiceSongRow(computerID: editor.computerID, song: song).foregroundStyle(.primary)
                            if iPad && readingID == song.id { Label("Reading on this iPad", systemImage: "book").font(.caption).foregroundStyle(Color.statiSecondary) }
                        }
                    }.buttonStyle(.plain)
                        .contextMenu { if canEdit { Button("Remove from service", systemImage: "trash", role: .destructive) { editor.remove(song.id) } } }
                        .moveDisabled(!canEdit)
                }.onMove(perform: editor.move)
                if canEdit { Button("Add song", systemImage: "plus") { adding = true } }
            } header: { SectionHeading("Running order · \(editor.songs.count)") }
            .dropDestination(for: String.self) { ids, _ in
                guard canEdit, let id = ids.first, id.count == 64 else { return false }
                Task { do { let song = APIRecord(raw: try await store.api.request("/computers/" + editor.computerID + "/songs/" + id).fields); editor.add(song) } catch { editor.message = error.localizedDescription } }; return true
            }
            LabeledSection("Notes") { if iPad { Text(editor.notes.isEmpty ? "No notes" : editor.notes).textSelection(.enabled) } else { TextEditor(text: $editor.notes).frame(minHeight: 96).disabled(!canEdit).accessibilityLabel("Service notes") } }
            Section {
                Button("Version history & changes", systemImage: "clock.arrow.circlepath") { history = true }
                if !iPad && editor.plan["leadership"]["isLeader"].flag { Button("Finalize running order", systemImage: "checkmark.seal") { Task { await editor.leadership("finalize-order") } } }
                if !iPad && editor.plan["leadership"]["canAcknowledge"].flag { Button("Acknowledge running order") { Task { await editor.leadership("acknowledge-order") } } }
            }
        }
        .environment(\.editMode, .constant(canEdit ? .active : .inactive))
        .toolbar {
            if !iPad, editor.plan["leadership"]["isLeader"].flag { Button("Leave service", systemImage: "person.badge.minus") { Task { await editor.leadership("release-leadership") } } }
            else if !iPad && (editor.plan["leadership"]["canClaim"].flag || editor.plan["leadership"]["canTakeOver"].flag) { Button(editor.plan["leadership"]["canTakeOver"].flag ? "Take over" : "Lead service") { Task { await editor.leadership("claim-leadership") } } }
        }
        .fullScreenCover(item: $preview) { SongGalleryView(store: store, request: $0, selectionChanged: { readingID = $0 }) }
        .sheet(isPresented: $adding) { NavigationStack { SongPicker(computerID: editor.computerID) { editor.add($0); adding = false } } }
        .sheet(isPresented: $history) { NavigationStack { ServiceHistoryView(computerID: editor.computerID, serviceID: editor.plan.id) } }
        #if DEBUG && targetEnvironment(simulator)
        .task { if NativeReview.route == "ipad-service-reader", let first = editor.songs.first { readingID = first.id; preview = SongGalleryRequest(computerID: editor.computerID, songs: editor.songs, selectedID: first.id, service: true) } }
        #endif
        .onDisappear { if !iPad && !editor.failed { Task { await editor.save() } } }
    }
}
