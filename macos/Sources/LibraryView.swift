import SwiftUI

struct LibraryView: View {
    @Bindable var model: WorkspaceModel
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Toggle("Favorites", isOn: $model.favoritesOnly).toggleStyle(.button).onChange(of: model.favoritesOnly) { _, _ in Task { model.libraryOffset = 0; await model.refresh() } }
                Spacer()
                Text("\(model.libraryTotal) matching songs").foregroundStyle(.secondary)
                Button("Share Library", systemImage: "arrow.triangle.2.circlepath") { Task { await model.command("song-library-rescan", message: "Library sharing updated.") } }
            }.padding(14)
            Table(model.rows.map(EngineRow.init), selection: $model.selection) {
                TableColumn("Song") { row in VStack(alignment: .leading, spacing: 3) { Text(row.value["title"].string).fontWeight(.medium); Text(row.value["firstLine"].string).font(.caption).foregroundStyle(.secondary).lineLimit(1) } }.width(min: 240, ideal: 450)
                TableColumn("Language") { row in Text(row.value["language"].string.uppercased()).foregroundStyle(.secondary) }.width(80)
                TableColumn("Version") { row in Text(row.value["groupName"].string.isEmpty ? "Original" : row.value["groupName"].string).foregroundStyle(.secondary) }.width(min: 80, ideal: 140)
            }.contextMenu(forSelectionType: String.self) { ids in
                if let id = ids.first { Button("Open Lyrics") { model.selection = id; Task { await model.loadSelection() } } }
            } primaryAction: { ids in if let id = ids.first { model.selection = id; Task { await model.loadSelection() } } }
            .overlay { if model.rows.isEmpty { ContentUnavailableView("No songs found", systemImage: "music.note.list", description: Text("Choose a Lyrics folder through Prepare slides, or change your search.")) } }
            HStack {
                Button("Previous") { model.libraryOffset = max(0, model.libraryOffset - 50); Task { await model.refresh() } }.disabled(model.libraryOffset == 0)
                Spacer(); Text("\(model.libraryOffset + (model.rows.isEmpty ? 0 : 1))–\(model.libraryOffset + model.rows.count)").font(.caption).foregroundStyle(.secondary); Spacer()
                Button("Next") { model.libraryOffset += 50; Task { await model.refresh() } }.disabled(model.libraryOffset + model.rows.count >= model.libraryTotal)
            }.padding(12)
        }
    }
}
