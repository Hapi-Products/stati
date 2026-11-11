import SwiftUI

struct CommenterRootView: View {
    let store: AppStore
    @Environment(\.displayScale) private var displayScale
    @State private var tab = "comments"
    @State private var account = false
    @State private var profile: UIImage?
    init(store: AppStore) {
        self.store = store
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route == "commenter-search" { _tab = State(initialValue: "search") }
        if NativeReview.route == "commenter-account" { _account = State(initialValue: true) }
        #endif
    }
    private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }
    var body: some View {
        TabView(selection: $tab) {
            if isPad {
                Tab("Comments", systemImage: "text.bubble", value: "comments") { NavigationStack { CommenterHomeView(store: store) } }
                Tab("Search", systemImage: "magnifyingglass", value: "search") { NavigationStack { CommenterSongSearch(store: store) } }
            } else {
                Tab(value: "comments") { NavigationStack { CommenterHomeView(store: store) } } label: { ActionTabSymbol(name: tab == "comments" ? "text.bubble.fill" : "text.bubble") }.accessibilityLabel("Comments")
                Tab(value: "account") { NavigationStack { CommenterAccountView() } } label: { if let profile { Image(uiImage: profile).renderingMode(.original) } else { ActionTabSymbol(name: tab == "account" ? "person.crop.circle.fill" : "person.crop.circle") } }.accessibilityLabel("Profile")
                Tab(value: "search", role: .statiSongSearch) { NavigationStack { CommenterSongSearch(store: store) } } label: { ActionTabSymbol(name: "magnifyingglass", weight: tab == "search" ? .semibold : .regular) }.accessibilityLabel("Search songs")
            }
        }.tabViewStyle(.sidebarAdaptable).defaultAdaptableTabBarPlacement(.tabBar).environment(store)
            .tabViewSidebarHeader { if isPad { HStack { IPadAccountButton(store: store) { account = true }; Spacer() }.padding(.vertical, 4).environment(store) } }
            .sheet(isPresented: $account) { NavigationStack { CommenterAccountView().toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close account", systemImage: "xmark") { account = false }.labelStyle(ActionIconLabelStyle()) } } }.environment(store) }
            .task(id: store.me?["photoUrl"].text) {
                profile = nil; let owner = store.me?.id, path = store.me?["photoUrl"].text ?? ""
                guard !path.isEmpty else { return }
                do { let bytes = try await store.api.bytes(path); try Task.checkCancellation(); if owner == store.me?.id { profile = ProfileTabImage.make(data: bytes, scale: displayScale) } } catch { }
            }
    }
}
