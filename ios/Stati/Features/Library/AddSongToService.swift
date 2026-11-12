import SwiftUI

struct AddSongToService: View {
    @Environment(AppStore.self) private var store
    let computerID: String
    let song: APIRecord
    let done: () -> Void

    @State private var plans: [APIRecord] = []
    @State private var selected: APIRecord?
    @State private var order: [APIRecord] = []
    @State private var message = ""
    @State private var busy = false
    @State private var loading = true
    @State private var epoch: UUID?
    @State private var appearanceID = UUID().uuidString.lowercased()
    private var path: String { "/computers/" + computerID + "/services" }
    private var active: Bool { epoch == store.accountEpoch && store.api.signedIn && store.canPlan }

    var body: some View {
        NavigationStack {
            List {
                if let selected {
                    Section {
                        ForEach(order) { row in
                            Group {
                                if row.id == appearanceID {
                                    Label(song.title, systemImage: "plus.circle.fill").foregroundStyle(.tint)
                                        .accessibilityHint("New song")
                                } else {
                                    Text(row.title)
                                }
                            }.moveDisabled(busy || row.id != appearanceID)
                        }
                        .onMove(perform: move)
                    } header: {
                        Text(selected.title)
                    } footer: {
                        Text("Drag the new song to its place in the running order.")
                    }
                } else if loading {
                    ProgressView("Loading services…")
                } else if plans.isEmpty && message.isEmpty {
                    ContentUnavailableView("No active services", systemImage: "calendar")
                } else {
                    Section {
                        ForEach(plans) { plan in
                            Button {
                                open(plan)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(plan.title)
                                    Text(ServiceSchedule.read(date: plan["date"].text, time: plan["time"].text)
                                        .formatted(date: .abbreviated, time: .shortened))
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .disabled(!canPlace(in: plan))
                        }
                    } footer: {
                        if plans.contains(where: { !$0["leadership"]["canEdit"].flag }) {
                            Text("You can add songs to services you have permission to edit.")
                        }
                    }
                }
                if !message.isEmpty {
                    Section {
                        NoticeView(text: message)
                        if selected == nil { Button("Reload services") { Task { await load() } } }
                    }
                }
            }
            .environment(\.editMode, .constant(selected == nil ? .inactive : .active))
            .navigationTitle(selected == nil ? "Add to service" : "Place song")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if selected == nil {
                        Button("Close", systemImage: "xmark", action: done).labelStyle(.iconOnly)
                    } else {
                        Button("Choose another service", systemImage: "chevron.backward") {
                            selected = nil
                            message = ""
                        }
                        .labelStyle(.iconOnly)
                        .disabled(busy)
                    }
                }
                if selected != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { Task { await save() } }.disabled(busy || !active)
                    }
                }
            }
        }
        .task { epoch = store.accountEpoch; await load() }
        .onChange(of: store.accountEpoch) { done() }
        .onChange(of: store.canPlan) { _, allowed in if !allowed { done() } }
        .interactiveDismissDisabled(busy)
    }

    private func canPlace(in plan: APIRecord) -> Bool {
        plan["leadership"]["canEdit"].flag && plan["songs"].items.count < 1000
    }

    private func open(_ plan: APIRecord, before nextID: String? = nil) {
        var rows = plan["songs"].records
        let newSong = APIRecord(raw: [
            "id": .string(appearanceID), "songId": .string(song.id), "title": .string(song.title),
            "filename": song["filename"], "contentHash": song["contentHash"], "reviewed": .bool(false)
        ])
        rows.insert(newSong, at: rows.firstIndex(where: { $0.id == nextID }) ?? rows.endIndex)
        order = rows
        selected = plan
        message = ""
    }

    private func move(_ offsets: IndexSet, to destination: Int) {
        guard !busy, let index = order.firstIndex(where: { $0.id == appearanceID }), offsets == IndexSet(integer: index) else { return }
        order.move(fromOffsets: offsets, toOffset: destination)
    }

    private func fetchPlans() async throws -> [APIRecord] {
        let response = try await store.api.request(path)
        try Task.checkCancellation()
        guard active else { throw CancellationError() }
        return response["plans"].records.filter { !$0["archived"].flag }
    }

    private func load() async {
        loading = true
        message = ""
        defer { loading = false }
        do { plans = try await fetchPlans() }
        catch is CancellationError {}
        catch { message = error.localizedDescription }
    }

    private func save() async {
        guard active, !busy, let selected else { return }
        busy = true
        message = ""
        defer { busy = false }
        do {
            let currentPlans = try await fetchPlans()
            guard var current = currentPlans.first(where: { $0.id == selected.id }) else {
                self.selected = nil
                plans = currentPlans
                message = "This service is no longer active."
                return
            }
            if current["songs"].records.contains(where: { $0.id == appearanceID }) {
                finish()
                return
            }
            guard canPlace(in: current) else {
                self.selected = nil
                plans = currentPlans
                message = "This service is full or your permission to edit it changed."
                return
            }
            if current["revision"] != selected["revision"] {
                let index = order.firstIndex(where: { $0.id == appearanceID })
                let nextID = index.flatMap { order.dropFirst($0 + 1).first?.id }
                open(current, before: nextID)
                message = "The service changed. Check the running order and press Done again."
                return
            }
            current["songs"] = .array(order.map(\.value))
            current["reviewed"] = .bool(false)
            let response = try await store.api.request(path, method: "POST", body: .object([
                "type": .string("save"), "id": .string(current.id), "plan": current.value
            ]))
            try Task.checkCancellation()
            guard active else { return }
            guard response["plans"].records.contains(where: { $0.id == current.id && $0["songs"].records.contains(where: { $0.id == appearanceID }) }) else {
                message = "Stați couldn’t confirm the save. Press Done to check before retrying."
                return
            }
            finish()
        } catch is CancellationError {}
        catch { if active { message = error.localizedDescription } }
    }

    private func finish() {
        store.servicesChanged(computerID: computerID)
        done()
    }
}
