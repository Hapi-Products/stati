import SwiftUI
import AppIntents

struct IPadFeaturesView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var preferences: ReaderPreferences
    @State private var showingHelp = false
    @AppStorage("stati.shortcuts.enabled") private var siriShortcuts = true
    @AppStorage("stati.liveSong.enabled") private var liveSong = false
    @AppStorage("stati.reader.libraryLayout") private var libraryLayout = "saved"
    @AppStorage("nativeReleaseNotes.automaticOnIPad") private var automaticUpdates = true

    init(ownerID: String) {
        _preferences = State(initialValue: ReaderPreferences(ownerID: ownerID, writesDeviceSettings: true))
    }

    var body: some View {
        @Bindable var preferences = preferences
        Form {
            Section {
                Link(destination: URL(string: UIApplication.openSettingsURLString)!) {
                    Label("Open Settings", systemImage: "gearshape")
                }
                AppIconPickerButton()
            }
            Section("Shortcuts") {
                Toggle("Siri Shortcuts", isOn: $siriShortcuts)
                ShortcutsLink()
            }
            Section("Service") {
                Toggle("Live song on Lock Screen", isOn: $liveSong)
            }
            Section("Reader") {
                Picker("Open songs as", selection: $preferences.settings.mode) {
                    ForEach(SongReaderMode.allCases) { Text($0.title).tag($0) }
                }
                Picker("Slide text size", selection: $preferences.settings.slideSize) {
                    ForEach(SlideTextSize.allCases) { Text($0.title).tag($0) }
                }
                Picker("PDF columns", selection: $preferences.settings.pdfColumns) {
                    ForEach(PDFColumnCount.allCases) { Text($0.title).tag($0) }
                }
                Picker("PDF page effect", selection: $preferences.settings.transition) {
                    ForEach(ReaderTransition.allCases) { Text($0.title).tag($0) }
                }
                Picker("Song selector", selection: $preferences.settings.selectorSource) {
                    ForEach(SongSelectorSource.allCases) { Text($0.title).tag($0) }
                }
                Toggle("Clicker", isOn: $preferences.settings.clickerEnabled)
            }
            Section("Library") {
                Toggle("Larger previews", isOn: $preferences.settings.largePreviews)
                Picker("Song library layout", selection: $libraryLayout) {
                    Text("Use saved preference").tag("saved")
                    Text("Grid").tag("grid")
                    Text("List").tag("list")
                }
            }
            Section("Recents") {
                Picker("Remove from Recents", selection: $preferences.settings.retention) {
                    ForEach(RecentRetention.allCases) { Text($0.title).tag($0) }
                }
            }
            Section("Updates") {
                Toggle("Show What’s New after updates", isOn: $automaticUpdates)
                NavigationLink("What’s New") { WhatsNewView() }
            }
        }
        .navigationTitle("Features")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Worship settings tips", systemImage: "lightbulb") { showingHelp = true }
                    .labelStyle(.iconOnly)
            }
        }
        .sheet(isPresented: $showingHelp) { WorshipHelpView(topic: .settings) }
        .onAppear {
            preferences.reload()
            #if DEBUG && targetEnvironment(simulator)
            if NativeReview.route == "ipad-worship-help" { showingHelp = true }
            #endif
        }
        .onChange(of: scenePhase) { _, phase in if phase == .active { preferences.reload() } }
        .onChange(of: preferences.settings.retention) { store.recents.prune(before: preferences.settings.retention.cutoff()) }
        .onReceive(NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)) { _ in preferences.reload() }
    }
}
