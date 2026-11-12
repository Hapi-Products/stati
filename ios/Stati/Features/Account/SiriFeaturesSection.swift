import AppIntents
import SwiftUI

struct SiriFeaturesSection: View {
    @AppStorage("stati.shortcuts.enabled") private var shortcuts = true
    @AppStorage("stati.siriAI.songSearch") private var songSearch = false

    var body: some View {
        Section {
            Toggle("Siri Shortcuts", isOn: $shortcuts)
            if #available(iOS 27.3, *) {
                Toggle("Siri AI Song Search", isOn: $songSearch)
            }
            ShortcutsLink()
            Link("Siri commands and setup", destination: URL(string: "https://github.com/Hapi-Products/stati/wiki/Siri-and-Shortcuts")!)
        } header: {
            Text("Siri")
        } footer: {
            Text("Shortcuts can open your song library, services and recents. Siri AI can search your library on supported devices.")
        }
    }
}
