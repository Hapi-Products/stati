import SwiftUI
struct IPadNavigation<Content: View>: View {
    let store: AppStore
    var path: Binding<[IPadSidebarRoute]>?
    @State private var localPath: [IPadSidebarRoute] = []
    @ViewBuilder let content: () -> Content
    var body: some View {
        NavigationStack(path: path ?? $localPath) { content().environment(store) }
            .toolbarVisibility(.visible, for: .tabBar)
            .environment(store)
    }
}
