import SwiftUI

struct IPadWorkspaceView: View {
    @Environment(\.scenePhase) private var scenePhase
    let store: AppStore
    @State private var overview: IPadLibraryOverview
    @State private var preferences: IPadPreferences
    @State private var groups: WorshipGroupsModel
    @State private var navigation = IPadWorkspaceSelection(tab: "browse")
    @State private var account = false
    @State private var showingRecents = false
    @State private var liveReader = LiveWorshipReader()
    @State private var liveSong: SongGalleryRequest?
    @State private var liveError = ""
    @State private var mutedService: String?
    @State private var chosenLiveGroup: String?
    @State private var wasFollowing = false

    private var livePlan: APIRecord? { overview.services.first { $0["active"].flag } }
    private var liveGroup: String? {
        if let chosenLiveGroup, groups.groups.contains(where: { $0.id == chosenLiveGroup }) { return chosenLiveGroup }
        if case .named(let id) = preferences.selection, groups.groups.contains(where: { $0.id == id }) { return id }
        if groupSelection == .automatic, groups.groups.count == 1 { return groups.groups.first?.id }
        return nil
    }
    private var liveScope: String {
        [store.accountEpoch.uuidString, store.selectedComputer, liveGroup ?? "", livePlan?.id ?? "", String(scenePhase == .active)].joined(separator: "|")
    }
    #if DEBUG && targetEnvironment(simulator)
    @State private var reviewGroup: GroupEditDraft?
    #endif
    init(store: AppStore) {
        self.store = store
        _overview = State(initialValue: IPadLibraryOverview(store: store)); _preferences = State(initialValue: IPadPreferences(ownerID: store.me?.id ?? "")); _groups = State(initialValue: WorshipGroupsModel(store: store))
        #if DEBUG && targetEnvironment(simulator)
        let route = NativeReview.route ?? ""
        if ["ipad-browse", "ipad-worship-library", "ipad-browse-list", "ipad-browse-list-large", "ipad-sidebar", "ipad-service-sidebar", "ipad-groups-none", "ipad-original", "ipad-search", "ipad-search-ranking", "ipad-reader-dismiss"].contains(route) { _navigation = State(initialValue: IPadWorkspaceSelection(tab: "browse")) }
        if route == "ipad-recents" { _showingRecents = State(initialValue: true) }
        if ["ipad-shared", "ipad-group-switcher", "ipad-scan-review", "ipad-shared-member", "ipad-file-preview", "ipad-chord-chart", "ipad-scan-pdf", "ipad-scan-form", "ipad-markup", "ipad-group-delete"].contains(route) { _navigation = State(initialValue: IPadWorkspaceSelection(tab: "shared")) }
        if route == "ipad-group-selected" { _navigation = State(initialValue: IPadWorkspaceSelection(tab: "shared", groupSelection: .named(NativeReview15.groupID))) }

        if ["ipad-service", "ipad-service-reader", "ipad-service-selector", "ipad-service-requests", "ipad-service-share"].contains(route) { _navigation = State(initialValue: IPadWorkspaceSelection(tab: "service", serviceID: NativeReview.plan["id"].text)) }
        if route == "ipad-service-list" { _navigation = State(initialValue: IPadWorkspaceSelection(tab: "service")) }
        if ["ipad-account", "ipad-worship", "ipad-team", "ipad-privacy", "ipad-whats-new", "ipad-features", "ipad-pdf-columns-features", "ipad-worship-help", "ipad-worship-help-next"].contains(route) { _account = State(initialValue: true) }
        #endif
    }
    private var preferredPlacement: AdaptableTabBarPlacement {
        #if DEBUG && targetEnvironment(simulator)
        if ["ipad-sidebar", "ipad-service-sidebar"].contains(NativeReview.route ?? "") { return .sidebar }
        #endif
        return .tabBar
    }
    private var showsGroups: Bool { store.canReadSongs && (store.isAdmin || (!preferences.selection.hidesGroups && !groups.groups.isEmpty)) }
    private var groupSelection: GroupSelection { navigation.groupSelection ?? preferences.selection }
    private var selectedGroupID: String? {
        if case .named(let id) = groupSelection { return groups.groups.contains(where: { $0.id == id }) ? id : nil }
        if groupSelection == .automatic && (groups.groups.count == 1 || !store.isAdmin) { return groups.groups.first?.id }
        return nil
    }
    private var legacyFileGroup: String { if case .legacy(let name) = groupSelection { return name }; return "__generic__" }
    var body: some View {
        workspace
            .environment(\.worshipLiveContext, liveContext)
            .task(id: liveScope) {
                guard scenePhase == .active else { liveReader.stop(store: store); return }
                await liveReader.listen(store: store, group: liveGroup ?? "", service: livePlan?.id ?? "")
            }
            .onChange(of: liveGroup) { _, group in
                if !liveReader.hosts(group: group ?? "", computer: store.selectedComputer) { resetLiveScope() }
            }
            .onChange(of: livePlan?.id) { if !liveReader.leadingStandalone { resetLiveScope() } }
            .onChange(of: store.accountEpoch) { resetLiveScope() }
            .onChange(of: liveReader.position) { updateFollowedReader() }
            .onChange(of: account) { if !account { updateFollowedReader() } }
            .fullScreenCover(item: $liveSong, onDismiss: {
                if wasFollowing && liveReader.following { mutedService = liveReader.followingSession }
                wasFollowing = false
            }) { request in
                SongGalleryView(store: store, request: request, followsLiveSession: wasFollowing)
                    .environment(\.worshipLiveContext, liveContext)
            }
    }

    private var workspace: some View {
        tabs
            .alert("Live reader unavailable", isPresented: Binding(get: { !liveError.isEmpty }, set: { if !$0 { liveError = "" } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(liveError) }
            .onChange(of: liveReader.message) { _, message in if !message.isEmpty { liveError = message } }
    }

    private var tabs: some View {
        TabView(selection: Binding(get: { navigation.tab }, set: { navigation.select($0) })) {
            if store.canReadSongs {
                if showsGroups {
                    Tab(value: "shared") {
                        IPadNavigation(store: store) {
                            IPadSharedFilesView(store: store, defaultGroup: legacyFileGroup, groupID: selectedGroupID,
                                               groupTitle: groups.groups.first(where: { $0.id == selectedGroupID })?.name,
                                               groups: groups, switchGroup: { id in
                                navigation.groupSelection = id.isEmpty ? .allGroups : .named(id)
                                if !id.isEmpty { chosenLiveGroup = id }
                            })
                            .id(selectedGroupID ?? legacyFileGroup)
                            .toolbar { if liveReader.following { ToolbarItem(placement: .topBarTrailing) { liveControls } } }
                        }
                    } label: { tabLabel("Groups", symbol: "person.2") }.accessibilityLabel("Groups")
                }
                Tab(value: "browse") {
                    IPadNavigation(store: store, path: $navigation.path) {
                        Group {
                            if showingRecents { IPadRecentsView() }
                            else {
                                IPadSongsView(title: preferences.selection == .originalSongs ? "Original Songs" : "Browse",
                                              group: preferences.selection == .originalSongs ? "__generic__" : "",
                                              serviceSongs: livePlan?["songs"].records ?? [])
                            }
                        }
                        .toolbar {
                            ToolbarItem(placement: .topBarLeading) {
                                Button(showingRecents ? "Browse library" : "Recents", systemImage: showingRecents ? "music.note.list" : "clock") {
                                    showingRecents.toggle()
                                }
                                .labelStyle(.iconOnly)
                            }
                            ToolbarItem(placement: .topBarTrailing) { liveControls }
                        }
                            .navigationDestination(for: IPadSidebarRoute.self) { page in
                                switch page {
                                case .service(let id): ServiceRouteView(computerID: store.selectedComputer, serviceID: id).id(store.accountEpoch.uuidString + store.selectedComputer + id)
                                case .group(let id): IPadSharedFilesView(store: store, defaultGroup: "__generic__", groupID: id, groupTitle: groups.groups.first(where: { $0.id == id })?.name, groups: groups)
                                case .folder(let name): IPadSongsView(title: name, group: name, serviceSongs: livePlan?["songs"].records ?? [])
                                }
                            }
                    }
                } label: { tabLabel("Browse", symbol: "music.note.list") }.accessibilityLabel("Browse")
            }
            if !store.canReadSongs {
                Tab(value: "account") {
                    ContentUnavailableView {
                        Label("Songs unavailable", systemImage: "music.note")
                    } description: {
                        Text("Your account needs song access to open the worship library.")
                    } actions: {
                        Button("Open Account") { account = true }
                    }
                } label: { tabLabel("Account", symbol: "person.crop.circle") }.accessibilityLabel("Account")
            }
            if store.canReadSongs {
                Tab(value: "service") {
                    IPadNavigation(store: store) { services.toolbar { if liveReader.following { ToolbarItem(placement: .topBarTrailing) { liveControls } } } }
                } label: { tabLabel("Service", symbol: "calendar") }.accessibilityLabel("Service")
                TabSection("Song folders") { ForEach(overview.songGroups, id: \.self) { group in Tab(group, systemImage: "folder", value: "group:" + group) { EmptyView() }.tabPlacement(.sidebarOnly) } }.tabPlacement(.sidebarOnly)
            }
        }.tabViewStyle(.sidebarAdaptable).defaultAdaptableTabBarPlacement(preferredPlacement).environment(\.symbolVariants, .none).environment(store)
            .tabViewSidebarHeader { Text("Stați Worship").font(.title2.bold()).padding(.vertical, 8) }
            .tabViewSidebarFooter { IPadAccountButton(store: store) { account = true }.padding(.vertical, 4).environment(store) }
            .sheet(isPresented: $account) { IPadAccountView(preferences: preferences, groups: overview.allGroups, namedGroups: groups).environment(store) }
            #if DEBUG && targetEnvironment(simulator)
            .sheet(item: $reviewGroup) { draft in WorshipGroupEditorView(store: store, groups: groups, draft: draft) { } }
            #endif
            .onChange(of: store.selectedComputer) { overview.reset(); showingRecents = false; chosenLiveGroup = nil; resetLiveScope(); navigation = IPadWorkspaceSelection(tab: "browse") }
            .onChange(of: store.serviceChangeRevision) { Task { await overview.loadServices(); if let id = navigation.serviceID, !overview.services.contains(where: { $0.id == id }) { navigation.serviceID = nil } } }
            .onChange(of: store.catalogChangeRevision) { Task { await overview.load() } }
            .onChange(of: store.groupChangeRevision) { Task { await groups.load() } }
            .onChange(of: groups.revision) {
                resolveDefault()
                if case .named(let id) = navigation.groupSelection, !groups.groups.contains(where: { $0.id == id }) { navigation.groupSelection = nil }
                if groups.loaded && navigation.tab == "shared" && !showsGroups { navigation.select("browse") }
            }
            .task(id: store.accountEpoch.uuidString + store.selectedComputer) { await loadWorkspace() }
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                preferences.reload()
                while !Task.isCancelled { do { try await Task.sleep(for: store.refreshDelay); await overview.loadServices(); await groups.load() } catch { return } }
            }
            .onChange(of: preferences.selection) { applyDefault() }
            .onReceive(NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)) { _ in preferences.reload() }
            .onChange(of: store.canReadSongs) { _, allowed in
                navigation.select(allowed ? "browse" : "account")
            }
            .onAppear { if !store.canReadSongs { navigation.select("account") } }
    }
    @ViewBuilder private func tabLabel(_ title: String, symbol: String) -> some View {
        if preferredPlacement == .sidebar { Label(title, systemImage: symbol) }
        else { Text(title) }
    }

    private func resetLiveScope() {
        liveReader.stop(store: store)
        liveSong = nil
        mutedService = nil
        wasFollowing = false
        liveReader.returnRequested = false
    }

    private func updateFollowedReader() {
        if liveReader.following, mutedService != liveReader.followingSession, !account, liveSong == nil,
           let position = liveReader.position {
            openLive(position, follower: true)
        }
        if !liveReader.following && wasFollowing { liveSong = nil; wasFollowing = false }
    }

    private var liveContext: WorshipLiveContext? {
        let plan = livePlan
        let role = store.me?["ministryRole"].text
        let canLeadSong = store.isAdmin || ["worship_leader", "choir_director", "pastor"].contains(role ?? "")
        return WorshipLiveContext(reader: liveReader, items: plan?["songs"].records ?? [], shouldOffer: {
            guard let plan, liveGroup != nil else { return false }
            let leadership = plan["leadership"]
            guard leadership["isLeader"].flag || leadership["canClaim"].flag,
                  !liveReader.following, liveReader.shouldOfferLeading(service: plan.id) else { return false }
            return true
        }, lead: { startLive($0, open: false) },
           canLeadSong: canLeadSong,
           canLeadService: liveGroup != nil && (plan?["leadership"]["isLeader"].flag == true || plan?["leadership"]["canClaim"].flag == true),
           chooseGroup: { position, group in
               if liveGroup != group { chosenLiveGroup = group }
               startStandalone(position, group: group)
           },
           availableGroups: groups.groups, selectedGroup: liveGroup,
           completeReturnToLive: {
               guard liveReader.returnRequested else { return }
               liveReader.returnRequested = false
               returnToLive()
           })
    }

    private func startStandalone(_ position: LiveWorshipReader.Position, group: String) {
        guard groups.groups.contains(where: { $0.id == group }), !liveReader.leading, !liveReader.starting else { return }
        liveReader.start(store: store, group: group, service: "", position: position)
    }

    @ViewBuilder private var liveControls: some View {
        if liveReader.following {
            Button("Back to Live", systemImage: "dot.radiowaves.left.and.right", action: returnToLive)
                .labelStyle(.iconOnly)
        } else {
            liveMenu
        }
    }

    private func returnToLive() {
        guard liveReader.following, let position = liveReader.position, liveSong == nil else { return }
        mutedService = nil
        openLive(position, follower: true)
    }

    private var liveMenu: some View {
        Menu {
            Text(liveReader.status.title)
            if groups.groups.count > 1 {
                Menu("Worship group", systemImage: "person.2") {
                    ForEach(groups.groups) { group in
                        Button(group.name, systemImage: group.id == liveGroup ? "checkmark" : "person.2") {
                            chosenLiveGroup = group.id
                        }
                    }
                }
            }
            if liveReader.starting {
                Text("Connecting…")
            } else if liveReader.leading {
                Button("Stop leading live", systemImage: "stop.circle") { liveReader.stop(store: store) }
            } else if let plan = livePlan, liveGroup != nil, let first = plan["songs"].records.first,
                      plan["leadership"]["isLeader"].flag || plan["leadership"]["canClaim"].flag {
                Button("Lead service", systemImage: "person.badge.plus") {
                    let settings = ReaderPreferences(ownerID: store.me?.id ?? "").settings
                    let position = LiveWorshipReader.Position(item: first.id, page: 0, mode: settings.mode,
                        transition: settings.transition, columns: settings.pdfColumns, size: settings.slideSize)
                    startLive(position, open: true)
                }
            } else if livePlan != nil && liveGroup == nil {
                Text("Choose a worship group to follow.")
            }
        } label: {
            Circle()
                .fill(liveReader.status.color)
                .frame(width: 20, height: 20)
                .frame(width: 32, height: 32)
                .contentShape(.rect)
        }
        .accessibilityLabel(liveReader.status.title)
    }

    private func startLive(_ position: LiveWorshipReader.Position, open: Bool) {
        guard let group = liveGroup, let plan = livePlan, !liveReader.starting, !liveReader.leading else { return }
        let computer = store.selectedComputer
        let epoch = store.accountEpoch
        Task {
            if !plan["leadership"]["isLeader"].flag {
                let editor = ServiceEditor(store: store, computerID: computer, plan: plan)
                await editor.leadership("claim-leadership")
                guard editor.plan["leadership"]["isLeader"].flag else {
                    liveError = editor.message.isEmpty ? "This service already has a leader." : editor.message
                    return
                }
            }
            guard epoch == store.accountEpoch, computer == store.selectedComputer, group == liveGroup, plan.id == livePlan?.id else { return }
            liveReader.start(store: store, group: group, service: plan.id, position: position)
            if open { openLive(position, follower: false) }
        }
    }

    private func openLive(_ position: LiveWorshipReader.Position, follower: Bool) {
        if position.songHash != nil {
            let item = SongGalleryItem(id: position.item, songID: position.item, title: liveReader.songTitle, contentHash: position.songHash ?? "")
            wasFollowing = follower
            liveSong = SongGalleryRequest(computerID: store.selectedComputer, items: [item], selectedID: item.id)
            return
        }
        guard let plan = livePlan else { return }
        let request = SongGalleryRequest(computerID: store.selectedComputer, songs: plan["songs"].records,
                                         selectedID: position.item, service: true, serviceID: plan.id)
        guard let request else { return }
        wasFollowing = follower
        liveSong = request
    }

    @ViewBuilder private var services: some View {
        if let id = navigation.serviceID {
            ServiceRouteView(computerID: store.selectedComputer, serviceID: id, showServices: {
                navigation.serviceID = nil
            }).id(store.accountEpoch.uuidString + store.selectedComputer + id)
        } else {
            IPadServicesView(openService: { navigation.serviceID = $0 })
        }
    }

    private func loadWorkspace() async {
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route == nil { ReaderPreferences.prepareDeviceDefaults(ownerID: preferences.ownerID) }
        #else
        ReaderPreferences.prepareDeviceDefaults(ownerID: preferences.ownerID)
        #endif
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
        case .named: navigation.select(showsGroups ? "shared" : "browse")
        case .legacy(let name): navigation.select(overview.songGroups.contains(name) ? "group:" + name : showsGroups ? "shared" : "browse")
        case .allGroups: navigation.select(showsGroups ? "shared" : "browse")
        case .automatic: navigation.select("browse")
        }
    }
}
