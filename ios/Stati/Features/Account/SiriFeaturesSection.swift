import AppIntents
import SwiftUI

struct SiriFeaturesSection: View {
    @AppStorage(StatiDeveloperMode.key) private var developerMode = false
    @AppStorage("stati.shortcuts.enabled") private var shortcuts = true
    @AppStorage("stati.siriAI.songSearch") private var songSearch = false

    var body: some View {
        if StatiDeveloperMode.isSupported {
            Section {
                Toggle(isOn: $developerMode) {
                    Label("Developer Mode", systemImage: "hammer")
                }
                if developerMode { siriActions }
            } footer: {
                Text("Try Stați’s Siri and Shortcuts actions on this device.")
            }
        } else if !StatiDeveloperMode.isBeta {
            Section("Siri") {
                Toggle(isOn: $shortcuts) { Label("Siri Shortcuts", systemImage: "shortcuts") }
                if shortcuts { siriActions }
            }
        }
    }

    @ViewBuilder private var siriActions: some View {
        if SiriPreviewAvailability.current == .ready {
            Toggle(isOn: $songSearch) { Label("Siri AI Song Search", systemImage: "sparkles") }
        }
        ShortcutsLink()
        Link(destination: URL(string: "https://github.com/Hapi-Products/stati/wiki/Siri-and-Shortcuts")!) {
            Label("Siri commands and setup", systemImage: "book")
        }
    }
}
