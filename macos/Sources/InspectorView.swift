import SwiftUI
import PDFKit
import AVKit

struct InspectorView: View {
    @Bindable var model: WorkspaceModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if model.destination == .library {
                    Text(model.librarySong.displayName).font(.title2.bold())
                    Text(model.libraryText).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    Button(model.selectedRow["favorite"].bool ? "Remove Favorite" : "Favorite Song", systemImage: "star") {
                        guard let id = model.selection else { return }
                        Task { await model.command("song-library-favorite", [.object(["id": .string(id), "favorite": .bool(!model.selectedRow["favorite"].bool)])]) }
                    }
                    Text("Lyrics are shown exactly as stored. Editing and version restoration remain in the existing desktop app during this preview.").font(.caption).foregroundStyle(.secondary)
                } else {
                    Text(model.selectedRow.displayName).font(.title2.bold())
                    if model.preview["kind"].string == "unsupported" { Text(model.preview["reason"].string).foregroundStyle(.secondary) }
                    else if let url = URL(string: model.preview["fileURL"].string), url.isFileURL {
                        if model.preview["kind"].string == "pdf" { PDFPreview(url: url).frame(minHeight: 420) }
                        else if model.preview["kind"].string == "image" || model.preview["mediaType"].string == "image" || ["png", "jpg", "jpeg", "gif", "webp"].contains(url.pathExtension.lowercased()), let image = NSImage(contentsOf: url) { Image(nsImage: image).resizable().scaledToFit() }
                        else { NativeMediaPreview(url: url).frame(minHeight: 240) }
                    } else {
                        Text(model.preview["text"].string).textSelection(.enabled)
                        ForEach(Array(model.preview["slides"].array.enumerated()), id: \.offset) { index, slide in
                            VStack(alignment: .leading) { Text("Slide \(index + 1)").font(.caption).foregroundStyle(.secondary); Text(slide["text"].string).textSelection(.enabled) }.padding().frame(maxWidth: .infinity, alignment: .leading).background(.quaternary, in: .rect(cornerRadius: 8))
                        }
                    }
                    if let id = model.selection {
                        Divider()
                        if model.selectedRow["status"].string == "queued" { Button("Save to Downloads", systemImage: "arrow.down.circle") { Task { await model.command("deliver", [.string(id)]) } }.buttonStyle(.borderedProminent) }
                        Button("Open Saved File", systemImage: "arrow.up.right.square") { Task { await model.command("file-open", [.string(id)]) } }
                        Button("Show in Finder", systemImage: "folder") { Task { await model.command("file-reveal", [.string(id)]) } }
                    }
                }
            }.padding(20)
        }
        .onChange(of: model.selection) { _, _ in if model.showInspector { Task { await model.loadSelection() } } }
    }
}
struct PDFPreview: NSViewRepresentable {
    let url: URL
    func makeNSView(context: Context) -> PDFView { let view = PDFView(); view.autoScales = true; view.document = PDFDocument(url: url); return view }
    func updateNSView(_ view: PDFView, context: Context) { if view.document?.documentURL != url { view.document = PDFDocument(url: url) } }
    static func dismantleNSView(_ view: PDFView, coordinator: ()) { view.document = nil }
}
struct NativeMediaPreview: View {
    let url: URL
    @State private var player: AVPlayer?
    var body: some View { VideoPlayer(player: player).onAppear { player = AVPlayer(url: url) }.onDisappear { player?.pause(); player = nil } }
}
