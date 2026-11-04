import SwiftUI

@main
struct StatiApp: App {
    @Environment(\.scenePhase) private var phase
    @State private var store = AppStore()
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
        WindowGroup { RootView().environment(store).tint(AppIconAppearance.shared.accent).onChange(of: phase) { _, phase in if phase == .active { AppIconAppearance.shared.synchronize() } } }
    }
}
