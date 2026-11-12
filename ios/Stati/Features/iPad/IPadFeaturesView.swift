import SwiftUI
import AppIntents

struct IPadFeaturesView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var preferences: ReaderPreferences
    @State private var guide = WorshipGuide()
    @State private var sizeWhileDragging: Double?
    @AppStorage("stati.shortcuts.enabled") private var siriShortcuts = true
    @AppStorage("stati.siriAI.songSearch") private var siriAISongSearch = false
    @AppStorage("stati.liveSong.enabled") private var liveSong = false
    @AppStorage("stati.reader.libraryLayout") private var libraryLayout = "grid"
    @AppStorage("nativeReleaseNotes.automaticOnIPad") private var automaticUpdates = true

    init(ownerID: String) {
        _preferences = State(initialValue: ReaderPreferences(ownerID: ownerID, writesDeviceSettings: true))
    }

    var body: some View {
        @Bindable var preferences = preferences
        Form {
            Section {
                readerOptions
                    .listRowInsets(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16))
            } header: {
                HStack(spacing: 4) {
                    Text("Songs")
                    Button("Show song settings guide", systemImage: "lightbulb") {
                        guide.start(.settings)
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                    .foregroundStyle(.tint)
                    .frame(minWidth: 44, minHeight: 44)
                }
            }
            Section("Controls") {
                Toggle("Clicker", isOn: $preferences.settings.clickerEnabled)
                Toggle("Live song on Lock Screen", isOn: $liveSong)
            }
            Section {
                Toggle("Siri Shortcuts", isOn: $siriShortcuts)
                Toggle("Siri AI Song Search", isOn: $siriAISongSearch)
                ShortcutsLink()
            } header: {
                Text("Siri")
            } footer: {
                Text("Siri AI searches your Stați song library on supported devices with Siri AI enabled.")
            }
            Section("Recents") {
                Picker("Remove from Recents", selection: $preferences.settings.retention) {
                    ForEach(RecentRetention.allCases) { Text($0.title).tag($0) }
                }
            }
            Section("App") {
                AppIconPickerButton()
                Toggle("Show What’s New after updates", isOn: $automaticUpdates)
                NavigationLink("What’s New") { WhatsNewView() }
            }
        }
        .navigationTitle("Features")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Link(destination: URL(string: UIApplication.openSettingsURLString)!) {
                    Label("Open Apple Settings", systemImage: "gearshape")
                }.labelStyle(.iconOnly)
            }
        }
        .onAppear { preferences.reload() }
        #if DEBUG && targetEnvironment(simulator)
        .task {
            guard NativeReview.route?.hasPrefix("ipad-worship-help") == true else { return }
            do { try await Task.sleep(for: .milliseconds(400)) } catch { return }
            guide.start(.settings)
            guard NativeReview.route == "ipad-worship-help-next" else { return }
            do { try await Task.sleep(for: .milliseconds(800)) } catch { return }
            guide.move(to: 1)
        }
        #endif
        .onDisappear { guide.stop() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { preferences.reload() } }
        .onChange(of: preferences.settings.retention) { store.recents.prune(before: preferences.settings.retention.cutoff()) }
        .onReceive(NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)) { _ in preferences.reload() }
    }

    @ViewBuilder private var readerOptions: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 16) {
                readingFormat
                slideSize
                selector
                previews
                layout
                pdfOptions
            }
        } else {
            ViewThatFits(in: .horizontal) {
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 16) {
                    GridRow { readingFormat; selector }
                    GridRow { slideSize; previews }
                    GridRow { layout; pdfOptions }
                }
                .frame(minWidth: 300)
                VStack(alignment: .leading, spacing: 16) {
                    readingFormat
                    slideSize
                    selector
                    previews
                    layout
                    pdfOptions
                }
            }
        }
    }

    private var readingFormat: some View {
        @Bindable var preferences = preferences
        return option("Open songs as") {
            Picker("Open songs as", selection: $preferences.settings.mode) {
                ForEach(SongReaderMode.allCases) { Text($0.title).tag($0) }
            }.labelsHidden()
        }
        .worshipGuide(guide, at: .readingFormat)
    }

    private var selector: some View {
        @Bindable var preferences = preferences
        return option("Song selector") {
            Picker("Song selector", selection: $preferences.settings.selectorSource) {
                ForEach(SongSelectorSource.allCases) { Text($0.title).tag($0) }
            }.labelsHidden()
        }
        .worshipGuide(guide, at: .selectorSetting)
    }

    private var slideSize: some View {
        let position = sizeWhileDragging ?? preferences.settings.slideSize.sliderPosition
        let points = SlideTextSize(sliderPosition: position)?.points ?? SlideTextSize.large.points
        return option("Slide text size") {
            Slider(value: Binding(
                get: { sizeWhileDragging ?? preferences.settings.slideSize.sliderPosition },
                set: { position in
                    if sizeWhileDragging != nil { sizeWhileDragging = position }
                    else if let size = SlideTextSize(sliderPosition: position) { preferences.settings.slideSize = size }
                }
            ), in: 0...3) { editing in
                if editing {
                    sizeWhileDragging = preferences.settings.slideSize.sliderPosition
                } else if let position = sizeWhileDragging {
                    sizeWhileDragging = nil
                    if let size = SlideTextSize(sliderPosition: position) { preferences.settings.slideSize = size }
                }
            }
            .accessibilityLabel("Slide text size")
            .accessibilityValue("\(Int(points.rounded())) points")
        }
        .worshipGuide(guide, at: .textSize)
    }

    private var previews: some View {
        @Bindable var preferences = preferences
        return option("Larger previews") {
            Toggle("Larger previews", isOn: $preferences.settings.largePreviews)
                .labelsHidden()
        }
    }

    private var layout: some View {
        option("Song library layout") {
            Picker("Song library layout", selection: $libraryLayout) {
                Text("Grid").tag("grid")
                Text("List").tag("list")
            }.labelsHidden()
        }
    }

    private var pdfOptions: some View {
        @Bindable var preferences = preferences
        return option("PDF options") {
            NavigationLink {
                Form {
                    Picker("Columns", selection: $preferences.settings.pdfColumns) {
                        ForEach(PDFColumnCount.allCases) { Text($0.title).tag($0) }
                    }
                    Picker("Page effect", selection: $preferences.settings.transition) {
                        ForEach(ReaderTransition.allCases) { Text($0.title).tag($0) }
                    }
                }.navigationTitle("PDF options")
            } label: {
                Label("Edit", systemImage: "doc").accessibilityLabel("Open PDF options")
            }
        }
    }

    private func option<Control: View>(_ title: String, @ViewBuilder control: () -> Control) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.subheadline).foregroundStyle(.secondary)
                .accessibilityHidden(true)
            control()
        }
        .frame(maxWidth: .infinity, minHeight: 59, alignment: .topLeading)
        .padding(10)
        .background(.quaternary.opacity(0.38), in: .rect(cornerRadius: 12))
    }
}
