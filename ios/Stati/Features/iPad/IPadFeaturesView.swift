import SwiftUI

struct IPadFeaturesView: View {
    @Environment(AppStore.self) private var store
    @Bindable var preferences: ReaderPreferences
    @AppStorage("nativeReleaseNotes.automaticOnIPad") private var automaticUpdates = true
    var body: some View {
        Form {
            Section { AppIconPickerButton() }
            Section("Updates") {
                Toggle("Show What’s New after updates", isOn: $automaticUpdates)
                NavigationLink("What’s New") { WhatsNewView() }
            }
            Section("Songs") {
                Picker("Open songs as", selection: $preferences.settings.mode) { ForEach(SongReaderMode.allCases) { Text($0.title).tag($0) } }
                Picker("Slide text size", selection: $preferences.settings.slideSize) { ForEach(SlideTextSize.allCases) { Text($0.title).tag($0) } }
                if preferences.settings.mode == .document {
                    Picker("PDF columns", selection: $preferences.settings.pdfColumns) { ForEach(PDFColumnCount.allCases) { Text($0.title).tag($0) } }
                    Picker("PDF page effect", selection: $preferences.settings.transition) { ForEach(ReaderTransition.allCases) { Text($0.title).tag($0) } } }
            }
            Section {
                Picker("Song Selector", selection: $preferences.settings.selectorSource) {
                    ForEach(SongSelectorSource.allCases) { Text($0.title).tag($0) }
                }
            } header: { Text("Song Selector") } footer: { Text("Current service uses the active service’s running order. When there’s no active service, the selector shows recent songs.") }
            Section {
                Toggle("Clicker usage", isOn: $preferences.settings.clickerEnabled)
            } header: { Text("Features") }
            Section {
                Picker("Remove from Recents", selection: $preferences.settings.retention) { ForEach(RecentRetention.allCases) { Text($0.title).tag($0) } }
            } header: { Text("Recents") } footer: { Text("History only. Files stay saved.") }
        }.navigationTitle("Features").navigationBarTitleDisplayMode(.inline)
            .onAppear { preferences.reload() }
            .onChange(of: preferences.settings.retention) { store.recents.prune(before: preferences.settings.retention.cutoff()) }
    }
}
