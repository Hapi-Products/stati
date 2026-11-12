import SwiftUI

struct IPadFeaturesView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var preferences: ReaderPreferences
    @State private var guide = WorshipGuide()
    @State private var opensPDFLayout = false
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
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
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
                Toggle(isOn: $preferences.settings.clickerEnabled) { Label("Clicker", systemImage: "cursorarrow.click") }
                Toggle(isOn: $liveSong) { Label("Live song on Lock Screen", systemImage: "waveform") }
            }
            SiriFeaturesSection()
            Section("Recents") {
                Picker(selection: $preferences.settings.retention) {
                    ForEach(RecentRetention.allCases) { Text($0.title).tag($0) }
                } label: { Label("Remove from Recents", systemImage: "clock") }
            }
            Section("App") {
                AppIconPickerButton()
                Toggle(isOn: $automaticUpdates) { Label("Show What’s New after updates", systemImage: "sparkles") }
                NavigationLink { WhatsNewView() } label: { Label("What’s New", systemImage: "sparkles") }
            }
        }
        .navigationDestination(isPresented: $opensPDFLayout) { pdfSettings }
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
                Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 4) {
                    GridRow { readingFormat; selector }
                    GridRow { slideSize; previews }
                    GridRow { layout; pdfOptions }
                }
                .frame(minWidth: 460)
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
        return option("Open songs as", icon: "music.note") {
            Picker("Open songs as", selection: $preferences.settings.mode) {
                ForEach(SongReaderMode.allCases) { Text($0.title).tag($0) }
            }.pickerStyle(.menu).labelsHidden().buttonStyle(.borderless)
            .worshipGuide(guide, at: .readingFormat)
        }
    }

    private var selector: some View {
        @Bindable var preferences = preferences
        return option("Song selector", icon: "music.note.list") {
            Picker("Song selector", selection: $preferences.settings.selectorSource) {
                ForEach(SongSelectorSource.allCases) { Text($0.title).tag($0) }
            }.pickerStyle(.menu).labelsHidden().buttonStyle(.borderless)
            .worshipGuide(guide, at: .selectorSetting)
        }
    }

    private var slideSize: some View {
        option("Slide text size", icon: "textformat.size") {
            SlideTextSizeSlider(size: preferences.settings.slideSize) {
                preferences.settings.slideSize = $0
            }
            .frame(height: 44)
            .worshipGuide(guide, at: .textSize)
        }
    }

    private var previews: some View {
        @Bindable var preferences = preferences
        return option("Larger previews", icon: "rectangle.grid.2x2") {
            Toggle("Larger previews", isOn: $preferences.settings.largePreviews)
                .labelsHidden()
                .accessibilityLabel("Larger previews")
        }
    }

    private var layout: some View {
        option("Song library layout", icon: "square.grid.2x2") {
            Picker("Song library layout", selection: $libraryLayout) {
                Text("Grid").tag("grid")
                Text("List").tag("list")
            }.pickerStyle(.menu).labelsHidden().buttonStyle(.borderless)
        }
    }

    private var pdfOptions: some View {
        option("PDF layout", icon: "doc.richtext") {
            Button("Open PDF layout", systemImage: "chevron.right") { opensPDFLayout = true }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .frame(minWidth: 44, minHeight: 44, alignment: .trailing)
        }
    }

    private var pdfSettings: some View {
        @Bindable var preferences = preferences
        return Form {
            Section {
                Picker("Columns", selection: $preferences.settings.pdfColumns) {
                    ForEach(PDFColumnCount.allCases) { Text($0.title).tag($0) }
                }
                Picker("Page transition", selection: $preferences.settings.transition) {
                    ForEach(ReaderTransition.allCases) { Text($0.title).tag($0) }
                }
            } footer: {
                Text("Applies when you open a song as a PDF.")
            }
        }
        .navigationTitle("PDF Layout")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func option<Control: View>(_ title: String, icon: String, @ViewBuilder control: () -> Control) -> some View {
        HStack(spacing: 12) {
            Label(title, systemImage: icon).foregroundStyle(.primary).accessibilityHidden(true)
            Spacer(minLength: 0)
            control()
                .frame(maxWidth: title == "Slide text size" ? 140 : nil, alignment: .trailing)
        }
        .frame(maxWidth: .infinity, minHeight: 44)
    }
}
