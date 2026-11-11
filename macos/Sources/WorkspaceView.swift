import SwiftUI

struct WorkspaceView: View {
    @Bindable var model: WorkspaceModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var sidebarSelection: Destination? = .station
    @State private var backHistory: [Destination] = []
    @State private var forwardHistory: [Destination] = []
    @State private var historyDestination: Destination?
    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            WorkspaceSidebar(model: model, selection: $sidebarSelection)
                .navigationSplitViewColumnWidth(min: 200, ideal: 232, max: 278)
        } detail: {
            VStack(spacing: 0) {
                if model.connected && !model.error.isEmpty {
                    HStack(spacing: 12) {
                        Label(model.error, systemImage: "exclamationmark.triangle")
                        Spacer()
                        Button("Retry") { Task { await model.retryConnection() } }
                            .disabled(model.connecting || model.refreshing)
                    }
                    .font(.callout)
                    .padding(12)
                    .background(.orange.opacity(0.12))
                    .accessibilityElement(children: .contain)
                }
                if !model.notice.isEmpty { Text(model.notice).font(.callout).foregroundStyle(.secondary).textSelection(.enabled).padding(10).frame(maxWidth: .infinity, alignment: .leading) }
                content
            }
            .background(Color(nsColor: .windowBackgroundColor))
            .navigationTitle(model.destination.rawValue)
            .workspaceSearch(model: model)
            .toolbar {
                ToolbarItemGroup(placement: .navigation) {
                    Button("Back", systemImage: "chevron.left") { navigateBack() }
                        .disabled(backHistory.isEmpty)
                    Button("Forward", systemImage: "chevron.right") { navigateForward() }
                        .disabled(forwardHistory.isEmpty)
                }
                ToolbarItemGroup {
                    if model.refreshing || model.working { ProgressView().controlSize(.small).accessibilityLabel("Working") }
                    if model.unlocked && model.destination == .station {
                        Button(model.status["receivingEnabled"].bool ? "Pause receiving" : "Receive files", systemImage: model.status["receivingEnabled"].bool ? "pause.circle" : "arrow.down.circle") {
                            Task { await model.command(model.status["receivingEnabled"].bool ? "receiver-close" : "receiver-open") }
                        }
                    }
                    Button("Refresh", systemImage: "arrow.clockwise") { Task { await model.retryConnection() } }
                        .disabled(model.connecting || model.refreshing)
                        .keyboardShortcut("r")
                    if model.unlocked && [.station, .library].contains(model.destination) {
                        Button("Preview", systemImage: "sidebar.right") { Task { if model.showInspector { model.showInspector = false } else { await model.loadSelection() } } }.disabled(model.selection == nil)
                    }
                    if model.station["adminUnlocked"].bool { Button("Invite Members", systemImage: "person.badge.plus") { Task { await model.showInvite() } } }
                }
            }
            .inspector(isPresented: $model.showInspector) {
                if model.unlocked { InspectorView(model: model).inspectorColumnWidth(min: 280, ideal: 340, max: 480) }
            }
        }
        .onChange(of: sidebarSelection) { _, next in
            guard let next, next != model.destination else { return }
            if historyDestination != next {
                backHistory.append(model.destination)
                forwardHistory.removeAll()
            }
            historyDestination = nil
            model.destination = next; model.search = ""; model.rows = []; model.selection = nil; model.showInspector = false; model.libraryOffset = 0
        }
        .task { await model.boot() }
        .task(id: model.destination) { await model.refresh() }
        .task(id: model.search) {
            guard model.destination == .library else { return }
            do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            model.libraryOffset = 0; await model.refresh()
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.refresh()
                do { try await Task.sleep(for: .seconds(20)) } catch { return }
            }
        }
        .sheet(isPresented: $model.showProfile, onDismiss: {
            Task { await model.dismissProfile() }
        }) { ProfileView(model: model, isSheet: true).frame(width: 550, height: 465) }
        .sheet(isPresented: $model.showInvitation) { QRSheet(title: "Invite Members", value: model.invitation) }
        .frame(minWidth: 780, minHeight: 520)
    }
    private func navigateBack() {
        guard let destination = backHistory.popLast() else { return }
        forwardHistory.append(model.destination)
        historyDestination = destination
        sidebarSelection = destination
    }

    private func navigateForward() {
        guard let destination = forwardHistory.popLast() else { return }
        backHistory.append(model.destination)
        historyDestination = destination
        sidebarSelection = destination
    }

    @ViewBuilder private var content: some View {
        if !model.connected {
            VStack(spacing: 12) {
                SettingsPaneHeader(
                    title: model.error.isEmpty ? "Connecting to Stați" : "Finish connecting",
                    subtitle: model.error.isEmpty ? "Opening your workspace on this Mac." : model.error,
                    symbol: "desktopcomputer"
                )
                if model.connecting {
                    ProgressView().controlSize(.small).accessibilityLabel("Connecting")
                } else if !model.error.isEmpty {
                    Button("Retry", systemImage: "arrow.clockwise") { Task { await model.retryConnection() } }
                        .statiActionStyle(prominent: true)
                }
            }
            .padding(22)
            .frame(maxWidth: 465)
            .background(.quaternary.opacity(0.35), in: .rect(cornerRadius: 18))
            .padding(28)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if model.status["locked"].bool {
            ContentUnavailableView("This computer is locked", systemImage: "lock", description: Text("Unlock macOS to continue. Your private workspace is hidden."))
        } else if model.destination == .settings {
            NativeSettingsView(model: model)
        } else if !model.pairingKnown {
            if model.error.isEmpty { ProgressView("Loading profiles…").frame(maxWidth: .infinity, maxHeight: .infinity) }
            else { ContentUnavailableView("Profiles unavailable", systemImage: "person.crop.circle") }
        } else if !model.paired {
            PairingView(model: model)
        } else if !model.unlocked {
            ProfileView(model: model)
        } else {
            switch model.destination {
            case .station: QueueView(model: model)
            case .library: LibraryView(model: model)
            case .services: ServicesView(model: model)
            case .prepare: PrepareView(model: model)
            case .clocks: NativeClocksView()
            case .settings: NativeSettingsView(model: model)
            case .tasks, .groups: TeamWorkspaceView(engine: model.engine, destination: model.destination, operatorId: model.status["operatorId"].string).id(model.status["operatorId"].string + model.destination.rawValue)
            }
        }
    }
}

extension View {
    @ViewBuilder fileprivate func workspaceSearch(model: WorkspaceModel) -> some View {
        if model.unlocked && [.station, .library].contains(model.destination) {
            @Bindable var binding = model
            searchable(text: $binding.search, prompt: model.destination == .library ? "Search songs" : "Search files")
        } else {
            self
        }
    }
}

struct QueueView: View {
    @Bindable var model: WorkspaceModel
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label(model.status["receivingEnabled"].bool ? "Receiving files" : "Receiving paused", systemImage: model.status["receivingEnabled"].bool ? "circle.fill" : "pause.circle")
                    .foregroundStyle(model.status["receivingEnabled"].bool ? .green : .secondary)
                Spacer(); Text("\(model.visibleRows.count) files").foregroundStyle(.secondary)
            }
            .font(.callout)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(.quaternary.opacity(0.35), in: .rect(cornerRadius: 12))
            .padding(.bottom, 12)
            Table(model.visibleRows.map(EngineRow.init), selection: $model.selection) {
                TableColumn("File") { row in Label(row.value.displayName, systemImage: "doc").lineLimit(1).help(row.value.displayName) }.width(min: 220, ideal: 420)
                TableColumn("From") { row in StationSenderView(value: row.value, engine: model.engine) }.width(min: 100, ideal: 160)
                TableColumn("Status") { row in Text(row.value["status"].string.capitalized).foregroundStyle(.secondary) }.width(min: 80, ideal: 110)
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if let id = ids.first {
                    Button("Preview") { model.selection = id; Task { await model.loadSelection() } }
                    Button("Save to Downloads") { Task { await model.command("deliver", [.string(id)]) } }
                    Button("Open Saved File") { Task { await model.command("file-open", [.string(id)]) } }
                    Button("Show in Finder") { Task { await model.command("file-reveal", [.string(id)]) } }
                }
            } primaryAction: { ids in if let id = ids.first { model.selection = id; Task { await model.loadSelection() } } }
            .clipShape(.rect(cornerRadius: 12))
            .overlay { if model.visibleRows.isEmpty { ContentUnavailableView("No files", systemImage: "tray", description: Text(model.search.isEmpty ? "Files sent to this station will appear here." : "No files match this search.")) } }
        }
        .padding(16)
    }
}
private struct StationSenderView: View {
    let value: JSONValue
    let engine: EngineClient

    var body: some View {
        let first = value["first_name"].string
        let last = value["last_initial"].string
        let name = first.isEmpty ? value["sender_name"].string : last.isEmpty ? first : first + " " + last + "."
        if !name.isEmpty {
            HStack(spacing: 7) {
                OperatorAvatar(id: value["sender_id"].string,
                               initials: String(name.prefix(1) + last.prefix(1)).uppercased(),
                               hasPhoto: value["has_photo"].bool || value["has_photo"].number == 1,
                               engine: engine, size: 21)
                Text(name).lineLimit(1)
            }
        }
    }
}

struct EngineRow: Identifiable { let value: JSONValue; var id: String { value.id }; init(_ value: JSONValue) { self.value = value } }
