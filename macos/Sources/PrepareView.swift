import SwiftUI

struct PrepareView: View {
    @Bindable var model: WorkspaceModel
    var body: some View {
        VStack(spacing: 14) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 14) { draftFields; draftActions }
                VStack(alignment: .leading, spacing: 12) { draftFields; draftActions }
            }
            .padding(14)
            .background(.quaternary.opacity(0.35), in: .rect(cornerRadius: 12))
            HSplitView {
                lyricsEditor.frame(minWidth: 245)
                slidePreview.frame(minWidth: 245)
            }
            if !model.lyrics.isEmpty {
                HStack(spacing: 12) {
                    if model.draftDirty {
                        Label("Unsaved draft", systemImage: "circle.dotted")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Menu("Export") {
                        Button("ProPresenter Presentation…") { Task { await model.exportSlides("presentation-export") } }
                        Button("Lyrics Document…") { Task { await model.exportSlides("lyrics-export") } }
                        Button("PowerPoint…") { Task { await model.exportSlides("powerpoint-export") } }
                    }
                    .disabled(!model.draftLoaded || model.working)
                    Button("Insert into ProPresenter") { Task { await model.exportSlides("presentation-insert") } }
                        .statiActionStyle(prominent: true)
                        .disabled(!model.draftLoaded || model.working)
                }
                .padding(12)
            }
        }
        .padding(16)
        .task(id: "\(model.draftOwner)|\(model.title)|\(model.lines)|\(model.lyrics)") {
            guard model.draftLoaded, model.draftDirty, model.unlocked else { return }
            do { try await Task.sleep(for: .milliseconds(700)) } catch { return }
            await model.saveDraft()
        }
        .onChange(of: model.lyrics) { _, _ in if model.draftLoaded { model.draftDirty = true } }
        .onChange(of: model.title) { _, _ in if model.draftLoaded { model.draftDirty = true } }
        .onChange(of: model.lines) { _, _ in if model.draftLoaded { model.draftDirty = true } }
    }

    private var lyricsEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Lyrics", systemImage: "text.alignleft")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            TextEditor(text: $model.lyrics)
                .font(.body)
                .scrollContentBackground(.hidden)
                .padding(10)
                .background(Color(nsColor: .textBackgroundColor), in: .rect(cornerRadius: 10))
                .accessibilityLabel("Song lyrics")
            Text("Use blank lines to separate slides.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .background(.quaternary.opacity(0.28), in: .rect(cornerRadius: 14))
        .padding(.trailing, 7)
    }

    private var slidePreview: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Slide Preview", systemImage: "rectangle.on.rectangle")
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if !model.slides.isEmpty {
                    Text("\(model.slides.count) slides")
                        .font(.callout.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            if model.slides.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "play.rectangle")
                        .font(.system(size: 27))
                        .accessibilityHidden(true)
                    Text("Enter lyrics and choose Preview.").font(.callout)
                }
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(18)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.quaternary.opacity(0.36), in: .rect(cornerRadius: 10))
            } else {
                ScrollView {
                    LazyVStack(spacing: 14) {
                        ForEach(Array(model.slides.enumerated()), id: \.offset) { index, slide in
                            VStack(alignment: .leading, spacing: 7) {
                                Text("\(index + 1) · \(slide["section"].string)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(slide["text"].string)
                                    .font(.title3)
                                    .multilineTextAlignment(.center)
                                    .padding(20)
                                    .frame(maxWidth: .infinity, minHeight: 135)
                                    .foregroundStyle(.white)
                                    .background(.black, in: .rect(cornerRadius: 10))
                            }
                        }
                    }
                    .padding(.trailing, 4)
                }
            }
        }
        .padding(14)
        .background(.quaternary.opacity(0.28), in: .rect(cornerRadius: 14))
        .padding(.leading, 7)
    }

    private var draftFields: some View {
        HStack(spacing: 12) {
            TextField("Song name", text: $model.title)
                .textFieldStyle(.roundedBorder)
                .frame(minWidth: 150)
            Picker("Lines per slide", selection: $model.lines) {
                ForEach(2...8, id: \.self) { Text("\($0) lines").tag($0) }
            }
            .fixedSize()
        }
    }

    private var draftActions: some View {
        HStack(spacing: 8) {
            Button("Preview") { Task { await model.previewSlides() } }
                .statiActionStyle()
                .disabled(model.lyrics.isEmpty || model.working)
            Button(model.draftSaving ? "Saving Draft…" : model.draftDirty ? "Save Draft" : "Draft Saved") {
                Task { await model.saveDraft() }
            }
            .statiActionStyle()
            .disabled(!model.draftLoaded || !model.draftDirty)
        }
        .fixedSize(horizontal: true, vertical: false)
    }

}
