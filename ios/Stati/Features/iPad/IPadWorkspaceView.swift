import SwiftUI

struct IPadWorkspaceView: View {
    @Environment(\.scenePhase) private var scenePhase
    let store: AppStore
    @State private var overview: IPadLibraryOverview
    @State private var preferences: IPadPreferences
    @State private var groups: WorshipGroupsModel
    @State private var navigation = IPadWorkspaceSelection(tab: "browse")
    @State private var account = false
    #if DEBUG && targetEnvironment(simulator)
    @State private var reviewGroup: GroupEditDraft?
    #endif
    init(store: AppStore) {
        self.store = store
        _overview = State(initialValue: IPadLibraryOverview(store: store)); _preferences = State(initialValue: IPadPreferences(ownerID: store.me?.id ?? "")); _groups = State(initialValue: WorshipGroupsModel(store: store))
        #if DEBUG && targetEnvironment(simulator)
        let route = NativeReview.route ?? ""
        if ["ipad-browse", "ipad-worship-library", "ipad-browse-list", "ipad-browse-list-large", "ipad-sidebar", "ipad-service-sidebar", "ipad-groups-none", "ipad-original", "ipad-search", "ipad-search-ranking", "ipad-reader-dismiss"].contains(route) { _navigation = State(initialValue: IPadWorkspaceSelection(tab: "browse")) }
        if route == "ipad-recents" { _navigation = State(initialValue: IPadWorkspaceSelection(tab: "groups")) }
        if ["ipad-shared", "ipad-scan-review", "ipad-shared-member", "ipad-file-preview", "ipad-scan-pdf", "ipad-scan-form", "ipad-markup", "ipad-group-delete"].contains(route) { _navigation = State(initialValue: IPadWorkspaceSelection(tab: "shared")) }
        if route == "ipad-group-selected" { _navigation = State(initialValue: IPadWorkspaceSelection(tab: "browse", path: [.group(NativeReview15.groupID)])) }

        if ["ipad-service", "ipad-service-reader", "ipad-service-selector", "ipad-service-requests", "ipad-service-share"].contains(route) { _navigation = State(initialValue: IPadWorkspaceSelection(tab: "service", servicePath: [.service(NativeReview.plan["id"].text)])) }
        if route == "ipad-service-list" { _navigation = State(initialValue: IPadWorkspaceSelection(tab: "service")) }
        if ["ipad-account", "ipad-worship", "ipad-team", "ipad-privacy", "ipad-whats-new", "ipad-features", "ipad-pdf-columns-features"].contains(route) { _account = State(initialValue: true) }
        #endif
    }
    private var preferredPlacement: AdaptableTabBarPlacement {
        #if DEBUG && targetEnvironment(simulator)
        if ["ipad-sidebar", "ipad-service-sidebar"].contains(NativeReview.route ?? "") { return .sidebar }
        #endif
        return .tabBar
    }
    private var showsGroups: Bool { store.canReadSongs && !preferences.selection.hidesGroups && (store.isAdmin || !groups.groups.isEmpty) }
    private var selectedGroupID: String? {
        if case .named(let id) = preferences.selection { return groups.groups.contains(where: { $0.id == id }) ? id : nil }
        if preferences.selection == .automatic && !store.isAdmin && groups.groups.count == 1 { return groups.groups.first?.id }
        return nil
    }
    private var legacyFileGroup: String { if case .legacy(let name) = preferences.selection { return name }; return "__generic__" }
    var body: some View {
        TabView(selection: Binding(get: { navigation.tab }, set: { navigation.select($0) })) {
            if store.canReadSongs {
                Tab("Recents", systemImage: "clock", value: "groups") { IPadNavigation(store: store) { IPadRecentsView(active: navigation.tab == "groups") } }
                if showsGroups { Tab("Groups", systemImage: "person.2", value: "shared") { IPadNavigation(store: store) { IPadSharedFilesView(store: store, defaultGroup: legacyFileGroup, groupID: selectedGroupID, groupTitle: groups.groups.first(where: { $0.id == selectedGroupID })?.name, groups: groups).id(selectedGroupID ?? legacyFileGroup) } } }
                Tab("Songs", systemImage: "music.note.list", value: "browse") {
                    IPadNavigation(store: store, path: $navigation.path) {
                        IPadSongsView(title: preferences.selection == .originalSongs ? "Original Songs" : "Songs", group: preferences.selection == .originalSongs ? "__generic__" : "")
                            .navigationDestination(for: IPadSidebarRoute.self) { page in
                                switch page {
                                case .service(let id): ServiceRouteView(computerID: store.selectedComputer, serviceID: id).id(store.accountEpoch.uuidString + store.selectedComputer + id)
                                case .group(let id): IPadSharedFilesView(store: store, defaultGroup: "__generic__", groupID: id, groupTitle: groups.groups.first(where: { $0.id == id })?.name, groups: groups)
                                case .folder(let name): IPadSongsView(title: name, group: name)
                                }
                            }
                    }
                }
            }
            if !store.canReadSongs {
                Tab("Account", systemImage: "person.crop.circle", value: "account") {
                    ContentUnavailableView {
                        Label("Songs unavailable", systemImage: "music.note")
                    } description: {
                        Text("Your account needs song access to open the worship library.")
                    } actions: {
                        Button("Open Account") { account = true }
                    }
                }
            }
            if store.canReadSongs {
                Tab("Service", systemImage: "calendar", value: "service") {
                    IPadNavigation(store: store, path: $navigation.servicePath) {
                        IPadServicesView().navigationDestination(for: IPadSidebarRoute.self) { page in
                            if case .service(let id) = page { ServiceRouteView(computerID: store.selectedComputer, serviceID: id).id(store.accountEpoch.uuidString + store.selectedComputer + id) }
                        }
                    }
                }
                if !groups.groups.isEmpty {
                    TabSection("Worship groups") { ForEach(groups.groups) { group in Tab(group.name, systemImage: "person.2", value: "named:" + group.id) { EmptyView() }.tabPlacement(.sidebarOnly) } }.tabPlacement(.sidebarOnly)
                }
                TabSection("Song folders") { ForEach(overview.songGroups, id: \.self) { group in Tab(group, systemImage: "folder", value: "group:" + group) { EmptyView() }.tabPlacement(.sidebarOnly) } }.tabPlacement(.sidebarOnly)
            }
        }.tabViewStyle(.sidebarAdaptable).defaultAdaptableTabBarPlacement(preferredPlacement).environment(\.symbolVariants, .none).environment(store)
            .tabViewSidebarHeader { Text("Stați Worship").font(.title2.bold()).padding(.vertical, 8) }
            .tabViewSidebarFooter { IPadAccountButton(store: store) { account = true }.padding(.vertical, 4).environment(store) }
            .sheet(isPresented: $account) { IPadAccountView(preferences: preferences, groups: overview.allGroups, namedGroups: groups).environment(store) }
            #if DEBUG && targetEnvironment(simulator)
            .sheet(item: $reviewGroup) { draft in WorshipGroupEditorView(store: store, groups: groups, draft: draft) { } }
            #endif
            .onChange(of: store.selectedComputer) { overview.reset(); navigation = IPadWorkspaceSelection(tab: "browse") }
            .onChange(of: store.serviceChangeRevision) { Task { await overview.loadServices(); if case .service(let id) = navigation.servicePath.last, !overview.services.contains(where: { $0.id == id }) { navigation.servicePath = [] } } }
            .onChange(of: store.catalogChangeRevision) { Task { await overview.load() } }
            .onChange(of: store.groupChangeRevision) { Task { await groups.load() } }
            .onChange(of: groups.revision) {
                resolveDefault()
                if case .group(let id) = navigation.path.last, !groups.groups.contains(where: { $0.id == id }) { navigation.path = [] }
                if navigation.tab == "shared" && !showsGroups { navigation.select("groups") }
            }
            .task(id: store.accountEpoch.uuidString + store.selectedComputer) { await loadWorkspace() }
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                while !Task.isCancelled { do { try await Task.sleep(for: store.refreshDelay); await overview.loadServices(); await groups.load() } catch { return } }
            }
            .onChange(of: preferences.selection) { applyDefault() }
            .onReceive(NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)) { _ in preferences.reload() }
            .onChange(of: store.canReadSongs) { _, allowed in
                navigation.select(allowed ? "browse" : "account")
            }
            .onAppear { if !store.canReadSongs { navigation.select("account") } }
    }
    private func loadWorkspace() async {
                guard store.canReadSongs else { return }
                async let metadata: Void = overview.load(); await groups.load(); await metadata
                resolveDefault()
                #if DEBUG && targetEnvironment(simulator)
                if NativeReview.route == nil { applyDefault() }
                if NativeReview.route == "ipad-group-editor" { var draft = GroupEditDraft(ownerID: NativeReview.userID); draft.name = "Sunday worship"; draft.memberIDs.insert(NativeReview15.memberID); reviewGroup = draft }
                #else
                applyDefault()
                #endif
                }
    private func resolveDefault() { preferences.resolve(named: Set(groups.groups.map(\.id)), legacy: Set(overview.allGroups), loaded: groups.loaded && overview.groupsLoaded) }
    private func applyDefault() {
        switch preferences.selection {
        case .originalSongs: navigation.select("browse")
        case .named: navigation.select(showsGroups ? "shared" : "groups")
        case .legacy(let name): navigation.select(overview.songGroups.contains(name) ? "group:" + name : showsGroups ? "shared" : "groups")
        case .allGroups: navigation.select(showsGroups ? "shared" : "groups")
        case .automatic: navigation.select("browse")
        }
    }
}
