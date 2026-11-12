import SwiftUI

@main
struct StatiApp: App {
    @Environment(\.scenePhase) private var phase
    @State private var store = AppStore()
    @State private var iconError: String?
    init() {
        UINavigationBar.appearance().tintColor = UIColor(named: "AccentColor")
        UIBarButtonItem.appearance().tintColor = UIColor(named: "AccentColor")
        let back = UIImage(systemName: "chevron.backward")?.withRenderingMode(.alwaysTemplate)
        UINavigationBar.appearance().backIndicatorImage = back
        UINavigationBar.appearance().backIndicatorTransitionMaskImage = back
        #if DEBUG && targetEnvironment(simulator)
        NativeReview15.configure()
        #endif
    }
    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .tint(AppIconAppearance.shared.accent)
                .task(id: phase) {
                    guard phase == .active else { return }
                    DiagnosticsLog.prune()
                    AppIconAppearance.shared.synchronize()
                    do { try await AppIconAppearance.shared.applyIPadPreference() }
                    catch { iconError = error.localizedDescription }
                }
                .alert("Could not change icon", isPresented: Binding(
                    get: { iconError != nil },
                    set: { if !$0 { iconError = nil } }
                )) {
                    Button("OK", role: .cancel) { iconError = nil }
                } message: {
                    Text(iconError ?? "")
                }
        }
    }
}
