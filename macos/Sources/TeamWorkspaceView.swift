import SwiftUI

struct TeamWorkspaceView: View {
    let engine: EngineClient
    let destination: Destination
    let operatorId: String
    @State private var model: TeamWorkspaceModel
    @Environment(\.scenePhase) private var scenePhase
    init(engine: EngineClient, destination: Destination, operatorId: String) {
        self.engine = engine; self.destination = destination; self.operatorId = operatorId
        _model = State(initialValue: TeamWorkspaceModel(engine: engine, destination: destination))
    }
    var body: some View {
        VStack(spacing: 0) {
            if !model.error.isEmpty { HStack { Label(model.error, systemImage: "exclamationmark.triangle"); Spacer(); Button("Refresh") { Task { await model.refresh() } } }.padding(12).background(.orange.opacity(0.12)) }
            HStack {
                TextField(destination == .tasks ? "Filter tasks" : "Filter groups", text: $model.query).textFieldStyle(.roundedBorder).frame(maxWidth: 300)
                Spacer()
                if model.busy { ProgressView().controlSize(.small) }
                Button("Refresh", systemImage: "arrow.clockwise") { Task { await model.refresh() } }
                if destination == .tasks { Button("New Task", systemImage: "plus") { model.showCreate = true } }
            }.padding(14)
            HSplitView {
                List(selection: $model.selected) {
                    ForEach(model.rows.filter { model.query.isEmpty || $0.displayName.localizedCaseInsensitiveContains(model.query) }.map(EngineRow.init)) { row in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack { Text(row.value.displayName).fontWeight(.medium); if row.value["urgent"].bool { Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.orange).accessibilityLabel("Urgent") } }
                            Text(destination == .tasks ? statusLabel(row.value["status"].string) : "\(Int(row.value["memberCount"].number)) members").font(.caption).foregroundStyle(.secondary)
                        }.padding(.vertical, 5).tag(row.id)
                    }
                }.frame(minWidth: 200, idealWidth: 280, maxWidth: 340)
                .safeAreaInset(edge: .bottom) { pagination }
                ScrollView {
                    if model.detail != .null {
                        VStack(alignment: .leading, spacing: 18) {
                            if destination == .tasks { taskDetail } else { groupDetail }
                            if !model.notice.isEmpty { Text(model.notice).font(.caption).foregroundStyle(.secondary) }
                            TeamAssetPreview(value: model.asset)
                        }.padding(24).frame(maxWidth: .infinity, alignment: .leading)
                    } else { ContentUnavailableView(destination == .tasks ? "Choose a task" : "Choose a group", systemImage: destination.symbol, description: Text(destination == .tasks ? "Review the original request and its discussion." : "Private membership and shared materials appear here.")) }
                }.frame(minWidth: 320)
            }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.refresh()
                do { try await Task.sleep(for: .seconds(20)) } catch { return }
            }
        }
        .onChange(of: model.selected) { _, _ in Task { await model.select() } }
        .onDisappear { model.close() }
        .sheet(isPresented: $model.showCreate) {
            VStack(alignment: .leading, spacing: 16) {
                Text("New Task").font(.title2.bold())
                TextField("Title", text: $model.title).textFieldStyle(.roundedBorder)
                TextEditor(text: $model.body).frame(height: 180).border(.quaternary).accessibilityLabel("Task description")
                Toggle("Urgent", isOn: $model.urgent)
                HStack { Button("Cancel") { model.showCreate = false }; Spacer(); Button("Create") { Task { await model.createTask() } }.buttonStyle(.borderedProminent).disabled(model.busy || model.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.title.count > 160 || model.body.count > 5000) }
                if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
            }.padding(26).frame(width: 470)
        }
    }
    @ViewBuilder private var pagination: some View {
        if destination == .tasks {
            HStack { Button("Previous") { model.offset = max(0, model.offset - 50); Task { await model.refresh() } }.disabled(model.offset == 0); Spacer(); Button("Next") { model.offset += 50; Task { await model.refresh() } }.disabled(model.offset + model.rows.count >= model.total) }.padding(10)
        } else if model.hasMoreGroups { Button("Load More Groups") { Task { await model.nextGroups() } }.padding(10) }
    }
    @ViewBuilder private var taskDetail: some View {
        let task = model.detail["task"]
        Text(task["title"].string).font(.title.bold())
        Text("\(task["authorName"].string) · \(statusLabel(task["status"].string))").foregroundStyle(.secondary)
        Text(task["body"].string).textSelection(.enabled)
        if task["canManage"].bool {
            Menu("Change Status") { ForEach(["new", "in-progress", "complete"], id: \.self) { status in Button(statusLabel(status)) { Task { await model.updateStatus(status) } } } }.disabled(model.busy)
        }
        ForEach(model.detail["images"].array.map(EngineRow.init)) { image in
            Button(image.value["filename"].string, systemImage: "photo") { Task { await model.loadAsset("/tasks/\(task.id)/images/\(image.id)") } }.disabled(model.busy)
        }
        Divider(); Text("Discussion").font(.headline)
        ForEach(model.detail["notes"].array.map(EngineRow.init)) { row in VStack(alignment: .leading, spacing: 5) { Text(row.value["authorName"].string).font(.caption).foregroundStyle(.secondary); Text(row.value["body"].string).textSelection(.enabled) }.padding(.vertical, 5) }
        if model.detail["noteTotal"].number > Double(model.detail["notes"].array.count) { Text("Showing \(model.detail["notes"].array.count) of \(Int(model.detail["noteTotal"].number)) notes. Open the existing desktop app for the full discussion.").font(.caption).foregroundStyle(.secondary) }
        TextField("Add a note", text: $model.note, axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(3...8)
        Button("Add Note") { Task { await model.addNote() } }.disabled(model.busy || model.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.note.count > 2000)
        Text("Task edits, deletions and image uploads remain in the existing desktop app during migration.").font(.caption).foregroundStyle(.secondary)
    }
    @ViewBuilder private var groupDetail: some View {
        Text(model.detail["name"].string).font(.title.bold())
        Text("Private group").font(.caption).foregroundStyle(.secondary)
        DisclosureGroup("Members (\(model.detail["members"].array.count))") {
            ForEach(model.detail["members"].array.map(EngineRow.init)) { member in
                let name = member.value["name"].string
                HStack(spacing: 8) {
                    OperatorAvatar(id: member.id, initials: name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased(),
                                   hasPhoto: !member.value["photoUrl"].string.isEmpty, engine: engine, size: 25)
                    Text(name)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 4)
            }
        }
        Divider(); Text("Shared Materials").font(.headline)
        ForEach(model.materials.map(EngineRow.init)) { material in
            VStack(alignment: .leading, spacing: 5) {
                Button(material.value["title"].string, systemImage: material.value["contentType"].string == "application/pdf" ? "doc.richtext" : "photo") { Task { await model.loadAsset("/group-materials/\(material.id)/file") } }.disabled(model.busy)
                Text("\(material.value["filename"].string) · \(material.value["authorName"].string)").font(.caption).foregroundStyle(.secondary)
            }.padding(.vertical, 4)
        }
        if model.materialsCursor != nil { Button("Load More Materials") { Task { await model.nextMaterials() } }.disabled(model.busy) }
        if model.materials.isEmpty { Text("No shared materials.").foregroundStyle(.secondary) }
        Text("Group creation, membership edits, material uploads and song attachments remain in the existing desktop app during migration.").font(.caption).foregroundStyle(.secondary)
    }
    private func statusLabel(_ value: String) -> String { switch value { case "new": "New"; case "in-progress": "In progress"; case "complete": "Complete"; default: value } }
}
struct TeamAssetPreview: View {
    let value: JSONValue
    var body: some View {
        if let url = URL(string: value["fileURL"].string), url.isFileURL {
            Divider()
            if value["contentType"].string == "application/pdf" { PDFPreview(url: url).frame(height: 520) }
            else if let image = NSImage(contentsOf: url) { Image(nsImage: image).resizable().scaledToFit().accessibilityLabel("Shared image") }
        } else if value["dataUrl"].string.hasPrefix("data:image/"), let comma = value["dataUrl"].string.firstIndex(of: ","), let bytes = Data(base64Encoded: String(value["dataUrl"].string[value["dataUrl"].string.index(after: comma)...])), let image = NSImage(data: bytes) {
            Divider(); Image(nsImage: image).resizable().scaledToFit().accessibilityLabel("Shared image")
        }
    }
}
