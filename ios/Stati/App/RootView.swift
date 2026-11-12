import SwiftUI

struct RootView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.displayScale) private var displayScale
    @State private var tab = "send"
    @State private var shortcuts = SongShortcutNavigation.shared
    @State private var liveActivities = ServiceLiveActivities()
    @AppStorage("stati.liveSong.enabled") private var liveSongEnabled = false
    @State private var shortcutRequest: SongShortcutRequest?
    #if DEBUG && targetEnvironment(simulator)
    @State private var reviewReader: SongGalleryRequest?
    @State private var reviewIcon = false
    #endif
    @State private var libraryQuery = ""
    @State private var searchPresented = false
    @State private var showingWhatsNew = false
    @AppStorage("nativeReleaseNotes.lastSeenBuild") private var lastSeenBuild = ""
    @AppStorage("nativeReleaseNotes.automaticOnIPad") private var automaticUpdatesOnIPad = true
    @State private var libraryArea = "songs"
    @State private var profileImage: UIImage?
    @State private var libraryPath: [LibraryRoute] = []
    @State private var taskPath: [String] = []
    @State private var morePath: [MoreRoute] = []
    init() {
        #if DEBUG && targetEnvironment(simulator)
        let route = NativeReview.route ?? ""
        _tab = State(initialValue: (["service", "songs", "groups", "group-share", "group-delete"].contains(route) || route.hasPrefix("song-")) ? "songs" : (["tasks", "task", "tasks-empty", "tasks-move"].contains(route) || route.hasPrefix("task-")) ? "tasks" : ["team", "team-member", "team-leader", "account", "account-member", "computers", "computers-invite", "computers-scan", "computers-pair-confirm", "computers-member", "computers-empty", "privacy", "whats-new", "profile", "profile-requests", "requests"].contains(route) ? "more" : "send")
        if route.hasPrefix("whats-new") { _tab = State(initialValue: "more"); _morePath = State(initialValue: [.whatsNew]) }
        if route == "phone-search-ranking" { _tab = State(initialValue: "songs"); _libraryQuery = State(initialValue: "Holy") }
        if route == "phone-folders" { _tab = State(initialValue: "songs") }
        if route == "privacy" { _morePath = State(initialValue: [.privacy]) }
        if route == "whats-new" { _morePath = State(initialValue: [.whatsNew]) }
        if route == "requests" { _morePath = State(initialValue: [.songRequests]) }
        if route.hasPrefix("song-") && route != "song-check" { _libraryPath = State(initialValue: [.song(NativeReview.songID)]) }
        if route == "service" { _libraryArea = State(initialValue: "services"); _libraryPath = State(initialValue: [.service(NativeReview.plan["id"].text)]) }
        if route == "groups" || route == "group-share" || route == "group-delete" { _libraryArea = State(initialValue: "groups") }
        if route == "task" || (route.hasPrefix("task-") && route != "task-editor-check") { _taskPath = State(initialValue: [NativeReview.task["id"].text]) }
        if ["team", "team-member", "team-leader"].contains(route) { _morePath = State(initialValue: [.team]) }
        if route.hasPrefix("computers") { _morePath = State(initialValue: [.computers]) }
        if ["account", "account-member"].contains(route) { _morePath = State(initialValue: [.account]) }
        #endif
    }
    var body: some View {
        VStack(spacing: 0) {
            #if DEBUG && targetEnvironment(simulator)
            if NativeReview.route != nil { Text("Sample data · Simulator review").font(.caption).dynamicTypeSize(.large).foregroundStyle(Color.statiSecondary).frame(maxWidth: .infinity).padding(.vertical, 4).background(.background) }
            #endif
            if !store.draftWarning.isEmpty { NoticeView(text: store.draftWarning).padding(.horizontal, 16) }
            normalContent
        }
            .task {
                #if DEBUG && targetEnvironment(simulator)
                if NativeReview.route?.hasPrefix("ipad-") == true, let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
                    scene.requestGeometryUpdate(.iOS(interfaceOrientations: NativeReview.route?.contains("landscape") == true ? .landscapeLeft : .portrait)) { error in
                        let text = error.localizedDescription
                        try? text.write(to: URL.applicationSupportDirectory.appending(path: "review-geometry-error.txt"), atomically: true, encoding: .utf8)
                    }
                }
                #endif
                await store.refresh()
                #if DEBUG && targetEnvironment(simulator)
                if ["ipad-system-settings", "phone-system-settings"].contains(NativeReview.route ?? ""),
                   let url = URL(string: UIApplication.openSettingsURLString) {
                    await UIApplication.shared.open(url)
                }
                else if NativeReview.route == "shortcut-song" {
                    let intent = FindStatiSong()
                    intent.query = "Amazing Grace"
                    _ = try? await intent.perform()
                }
                else if NativeReview.route == "theme-check" { await NativeThemeChecks.run() }
                else if NativeReview.route == "library-performance-check" { await NativeLibraryPerformanceChecks.run(store: store) }
                else if NativeReview.route == "correction-check" { await NativeSongCorrectionChecks.run(store: store) }
                else if NativeReview.route == "owner-hosting-check" { NativeOwnerHostingChecks.run(store: store) }
                else if NativeReview.route == "export-check" { await NativeExportChecks.run(store: store) }
                else if NativeReview.route == "task-refresh-check" { await NativeTaskRefreshChecks.run(store: store) }
                else if NativeReview.route == "groups-check" { await NativeGroupsChecks.run(store: store) }
                else if NativeReview.route == "reader-check" { await NativeReaderChecks.run(store: store) }
                else if NativeReview.route == "workspace-check" { await NativeWorkspaceChecks.run(store: store) }
                else if NativeReview.route == "markup-check" { await NativeMarkupChecks.run(store: store) }
                else if NativeReview.route == "scan-check" { await NativeScanChecks.run(store: store) }
                else if NativeReview.route == "file-check" { await NativeFilePreviewChecks.run() }
                else if NativeReview.route == "task-editor-check" { await NativeTaskEditorChecks.run() }
                else if NativeReview.route == NativeSendNetworkCheck.route { await NativeSendNetworkCheck.run(api: store.api) }
                else if NativeReview.route == "recovery-check" { await NativeRecoveryChecks.run(api: store.api) }
                else if NativeReview.route == "song-check" { await NativeSongCommandChecks.run() }
                else if NativeReview.route != nil { NativeReview.prepareQueue(store: store); await NativeReviewIPad.prepareRecents(store: store); if NativeReaderReview.active { reviewReader = NativeReaderReview.request }; if NativeReview.route?.hasPrefix("app-icons") == true { reviewIcon = true } }
                #endif
            }
            #if DEBUG && targetEnvironment(simulator)
            .sheet(isPresented: $reviewIcon) { AppIconPickerSheet() }
            .fullScreenCover(item: $reviewReader) { SongGalleryView(store: store, request: $0) }
            #endif
            .task(id: shortcuts.request?.id.uuidString.appending(store.canReadSongs ? "ready" : "waiting")) {
                guard store.canReadSongs, let request = shortcuts.request,
                      !IPadRoleAccess.isBlocked(ministryRole: store.me?["ministryRole"].text ?? "", isPad: UIDevice.current.userInterfaceIdiom == .pad) else { return }
                shortcuts.request = nil
                shortcutRequest = request
            }
            .fullScreenCover(item: $shortcutRequest) { SongShortcutDestination(store: store, request: $0) }
            .task(id: store.me?.id) {
                let owner = store.me?.id
                store.taskCount = 0
                guard owner != nil else { return }
                #if !targetEnvironment(simulator)
                checkReleaseNotes()
                #else
                if NativeReview.route == "ipad-whats-new-auto" { lastSeenBuild = "22"; automaticUpdatesOnIPad = true; checkReleaseNotes() }
                #endif
                if UIDevice.current.userInterfaceIdiom != .pad { await store.refreshTaskCount() }
            }
            .sheet(isPresented: $showingWhatsNew, onDismiss: { lastSeenBuild = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "" }) {
                NavigationStack { WhatsNewView() }
            }
            .task(id: taskEventScope + store.selectedComputer + String(liveSongEnabled) + String(store.canReadSongs)) {
                await liveActivities.follow(store: store, enabled: liveSongEnabled, foreground: scenePhase == .active)
            }
            .task(id: taskEventScope) {
                #if DEBUG && targetEnvironment(simulator)
                if NativeReview.route != nil { return }
                #endif
                guard scenePhase == .active, let owner = store.me?.id, store.api.signedIn else { return }
                let epoch = store.accountEpoch
                await TaskEventFeed(api: store.api).run(isCurrent: { store.me?.id == owner && store.accountEpoch == epoch && store.api.signedIn && scenePhase == .active }, invalidate: { store.workspaceInvalidated($0) }, connected: { live in if store.me?.id == owner && store.accountEpoch == epoch { store.workspaceLive = live } })
            }
            .onChange(of: store.me?.id) { previous, current in
                if previous != nil && previous != current { shortcuts.request = nil; shortcutRequest = nil; profileImage = nil; libraryQuery = ""; libraryPath = []; taskPath = []; morePath = []; libraryArea = "songs"; tab = "send" }
            }
            .onChange(of: store.canReadSongs) { _, allowed in if !allowed && tab == "songs" { tab = "send"; libraryQuery = ""; libraryPath = [] } }
            .task(id: taskEventScope + tab) {
                guard tab != "send", scenePhase == .active, store.me != nil else { return }
                while !Task.isCancelled {
                    await store.uploads.refreshSavedSongs()
                    do { try await Task.sleep(for: .seconds(60)) } catch { return }
                }
            }
            .onChange(of: scenePhase) { _, phase in if phase == .active && !store.authenticating { Task { await store.refresh() } } }
    }
    private func checkReleaseNotes() {
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        guard !IPadRoleAccess.isBlocked(ministryRole: store.me?["ministryRole"].text ?? "", isPad: isPad) else { return }
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        showingWhatsNew = ReleaseNotesPolicy.shouldPresent(isIPad: isPad, automaticOnIPad: automaticUpdatesOnIPad, lastSeen: lastSeenBuild, current: build)
        if !showingWhatsNew { lastSeenBuild = build }
    }
    private var taskEventScope: String { store.accountEpoch.uuidString + (store.me?.id ?? "") + (scenePhase == .active ? "active" : "inactive") }
    private var normalContent: some View {
        Group {
            if store.loading && store.me == nil { ProgressView(UIDevice.current.userInterfaceIdiom == .pad ? "Opening Stați Worship…" : "Opening Stați…") }
            else if let person = store.me {
                if person["status"].text != "active" {
                    NavigationStack { ContentUnavailableView("Waiting for approval", systemImage: "person.badge.clock", description: Text("Your church administrator needs to approve your account.")).toolbar { Button("Sign out") { Task { await store.signOut() } } } }
                } else {
                    if IPadRoleAccess.isBlocked(ministryRole: person["ministryRole"].text, isPad: UIDevice.current.userInterfaceIdiom == .pad) { IPadAccessUnavailableView(store: store) }
                    else if store.isCommenter { CommenterRootView(store: store).id(store.accountEpoch) }
                    else if UIDevice.current.userInterfaceIdiom == .pad { IPadWorkspaceView(store: store).id(store.accountEpoch) }
                    else { mainTabs.id(store.accountEpoch) }
                }
            } else { SignInView() }
        }
    }
    private var searchPrompt: String { libraryArea == "services" ? "Search services" : libraryArea == "groups" ? "Search shared files" : "Search songs or lyrics" }
    private var mainTabs: some View {
        TabView(selection: $tab) {
            Tab(value: "send") { NavigationStack { SendView(active: tab == "send") } } label: { ActionTabSymbol(name: tab == "send" ? "square.and.arrow.up.fill" : "square.and.arrow.up") }.accessibilityLabel("Send")
            Tab(value: "tasks") { NavigationStack(path: $taskPath) { TasksView(active: tab == "tasks") } } label: { ActionTabSymbol(name: TaskTabImage.symbolName(selected: tab == "tasks", hasTasks: store.taskCount > 0), weight: .medium) }.accessibilityLabel("Tasks")
            Tab(value: "more") { NavigationStack(path: $morePath) { ProfileView() } } label: {
                if let profileImage { Image(uiImage: profileImage).renderingMode(.original) }
                else { ActionTabSymbol(name: tab == "more" ? "person.crop.circle.fill" : "person.crop.circle") }
            }.accessibilityLabel("Profile")
            if store.canReadSongs {
                Tab(value: "songs", role: .statiSongSearch) { NavigationStack(path: $libraryPath) { LibraryView(query: $libraryQuery, area: $libraryArea) }.searchable(text: $libraryQuery, isPresented: $searchPresented, prompt: Text(searchPrompt).foregroundStyle(Color.statiSecondary)) } label: { ActionTabSymbol(name: "magnifyingglass", weight: tab == "songs" ? .semibold : .regular) }.accessibilityLabel("Songs and search")
            }
        }
        .tabViewSearchActivation(.automatic)
        .onChange(of: tab) { _, current in searchPresented = current == "songs" }
        .task(id: store.me?["photoUrl"].text ?? "") {
            profileImage = nil
            guard let person = store.me, !person["photoUrl"].text.isEmpty else { return }
            let path = person["photoUrl"].text
            do {
                let data = try await store.api.bytes(path)
                try Task.checkCancellation()
                if store.me?.id == person.id { profileImage = ProfileTabImage.make(data: data, scale: displayScale) }
            } catch { }
        }
    }

}
