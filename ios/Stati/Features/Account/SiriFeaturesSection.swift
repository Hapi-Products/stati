import AppIntents
import SwiftUI

struct SiriFeaturesSection: View {
    @AppStorage(StatiDeveloperMode.key) private var developerMode = false
    @AppStorage("stati.shortcuts.enabled") private var shortcuts = true
    @AppStorage("stati.siriAI.songSearch") private var songSearch = false

    @State private var confirmsDeveloperMode = false

    private var developerModeToggle: Binding<Bool> {
        Binding(get: { developerMode }, set: { enabled in
            if enabled { confirmsDeveloperMode = true }
            else { developerMode = false }
        })
    }

    var body: some View {
        if StatiDeveloperMode.isSupported {
            Section {
                Toggle(isOn: developerModeToggle) {
                    Label("Developer Mode", systemImage: "hammer")
                }
                if developerMode { siriActions }
            } footer: {
                Text("Try Stați’s Siri and Shortcuts actions on this device.")
            }
            .alert("Turn on Developer Mode?", isPresented: $confirmsDeveloperMode) {
                Button("Cancel", role: .cancel) {}
                Button("Turn On") { developerMode = true }
            } message: {
                Text("This enables Stați’s preview actions in Siri and Shortcuts on this device.")
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
