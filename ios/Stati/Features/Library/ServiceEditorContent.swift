import SwiftUI

struct ServiceEditorContent: View {
    @Environment(AppStore.self) private var store
    @Bindable var editor: ServiceEditor
    private var iPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }
    private var canEdit: Bool { editor.canEdit && !iPad }
    private var leadership: JSONValue { editor.plan["leadership"] }
    @State private var guide = WorshipGuide()
    @State private var readingID: String?
    @State private var adding = false
    @State private var history = false
    @State private var showingRequests = false
    @State private var confirmingLeadership: String?
    @State private var preview: SongGalleryRequest?
    var body: some View {
        List {
            if !editor.message.isEmpty { Section { NoticeView(text: editor.message); if editor.failed { Button("Retry saving") { Task { await editor.save() } } } } }
            Section {
                if iPad {
                    Text(editor.title).font(.title2.bold()).accessibilityAddTraits(.isHeader)
                    Label(editor.schedule.formatted(date: .abbreviated, time: .shortened), systemImage: "calendar").textSelection(.enabled)
                } else {
                    TextField("Service name", text: $editor.title).disabled(!canEdit)
                    DatePicker("Date", selection: $editor.schedule, displayedComponents: .date).disabled(!canEdit)
                    DatePicker("Time", selection: $editor.schedule, displayedComponents: .hourAndMinute).disabled(!canEdit)
                }
            }
            Section("Service leader") {
                if leadership["leaderLabel"].text.isEmpty { Text("No leader assigned").foregroundStyle(.secondary) }
                else { ServiceLeaderBadge(plan: editor.plan) }
            }
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
                if editor.canEdit {
                    Button("Add song from library", systemImage: "plus") { adding = true }
                        .disabled(editor.changingLeader || editor.songs.count >= 1000)
                }
                if iPad && !editor.plan["archived"].flag {
                    Button("Song requests and uploads", systemImage: "tray.and.arrow.up") { showingRequests = true }
                }
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
            if iPad {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    leadershipActions.labelStyle(.iconOnly)
                    Button("Refresh service", systemImage: "arrow.clockwise") {
                        guide.stop()
                        Task { await editor.refresh() }
                    }
                    .labelStyle(.iconOnly)
                    .worshipGuide(guide, at: .serviceRefresh)
                    Button("Service controls help", systemImage: "questionmark.circle") {
                        guide.start(.service)
                    }.labelStyle(.iconOnly)
                }
            } else {
                ToolbarItem(placement: .topBarTrailing) { leadershipActions }
            }
        }
        .confirmationDialog(leadershipConfirmation, isPresented: Binding(get: { confirmingLeadership != nil }, set: { if !$0 { confirmingLeadership = nil } }), titleVisibility: .visible) {
            if let action = confirmingLeadership {
                Button(action == "release-leadership" ? "Leave leadership" : "Take over") {
                    Task { await editor.leadership(action) }
                }
            }
        }
        .alert("Service leadership changed", isPresented: Binding(get: { !editor.leadershipNotice.isEmpty }, set: { if !$0 { editor.leadershipNotice = "" } })) {
            Button("OK", role: .cancel) { editor.leadershipNotice = "" }
        } message: { Text(editor.leadershipNotice) }
        .refreshable { await editor.refresh() }
        .fullScreenCover(item: $preview) { SongGalleryView(store: store, request: $0, selectionChanged: { readingID = $0 }) }
        .sheet(isPresented: $adding) { NavigationStack { SongPicker(computerID: editor.computerID) { editor.add($0); adding = false } } }
        .sheet(isPresented: $showingRequests) { ServiceSongRequestsView(computerID: editor.computerID, serviceID: editor.plan.id, title: editor.title) }
        .sheet(isPresented: $history) { NavigationStack { ServiceHistoryView(computerID: editor.computerID, serviceID: editor.plan.id) } }
        #if DEBUG && targetEnvironment(simulator)
        .task {
            let route = NativeReview.route ?? ""
            if route == "ipad-service-requests" { showingRequests = true }
            if ["ipad-service-reader", "ipad-service-selector", "ipad-service-share"].contains(route), let first = editor.songs.first {
                readingID = first.id
                preview = SongGalleryRequest(computerID: editor.computerID, songs: editor.songs, selectedID: first.id, service: true)
            }
        }
        #endif
        .onDisappear { if !editor.failed { Task { await editor.save() } } }
    }

    private var leadershipConfirmation: String {
        confirmingLeadership == "release-leadership" ? "Leave leadership of " + editor.title + "?" : "Take over " + editor.title + " from " + leadership["leaderLabel"].text + "?"
    }

    @ViewBuilder private var leadershipActions: some View {
        if leadership["isLeader"].flag, !editor.plan["archived"].flag {
            Button("Leave leadership", systemImage: "person.badge.minus") { confirmingLeadership = "release-leadership" }
                .disabled(editor.saving || editor.changingLeader)
        } else if leadership["canTakeOver"].flag {
            Button("Take over", systemImage: "person.badge.plus") { confirmingLeadership = "claim-leadership" }
                .disabled(editor.saving || editor.changingLeader)
        } else if leadership["canClaim"].flag {
            Button("Lead service", systemImage: "person.badge.plus") { Task { await editor.leadership("claim-leadership") } }
                .disabled(editor.saving || editor.changingLeader)
        }
    }

}
