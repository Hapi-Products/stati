import SwiftUI

struct ServicesView: View {
    @Bindable var model: WorkspaceModel
    @State private var offlineVersion = ""
    @State private var offlinePassphrase = ""
    @State private var showOffline = false
    var body: some View {
        HSplitView {
            List(selection: $model.selection) {
                ForEach(model.rows.filter { model.search.isEmpty || $0.displayName.localizedCaseInsensitiveContains(model.search) }.map(EngineRow.init)) { row in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(row.value["title"].string).fontWeight(.medium)
                        Text("\(row.value["date"].string) · \(row.value["time"].string)").font(.caption).foregroundStyle(.secondary)
                        Text("\(row.value["songs"].array.count) songs\(row.value["active"].bool ? " · Active" : "")\(row.value["archived"].bool ? " · Archived" : "")").font(.caption).foregroundStyle(.secondary)
                    }.padding(.vertical, 5).tag(row.id)
                }
            }.frame(minWidth: 200, idealWidth: 270, maxWidth: 330)
            .safeAreaInset(edge: .bottom) {
                if model.capabilities["planServices"].bool { Button("New Service", systemImage: "plus") { model.showNewService = true }.padding(12) }
            }
            ScrollView {
                if model.service != .null {
                    VStack(alignment: .leading, spacing: 18) {
                        Text(model.service["title"].string).font(.title.bold())
                        Text("\(model.service["date"].string) · \(model.service["time"].string)").foregroundStyle(.secondary)
                        if !model.service["leadership"]["leaderLabel"].string.isEmpty { Label(model.service["leadership"]["leaderLabel"].string, systemImage: "person") }
                        HStack {
                            if model.service["leadership"]["canClaim"].bool { Button("Lead Service") { Task { await model.serviceAction("claim-leadership") } } }
                            if model.service["leadership"]["isLeader"].bool { Button("Finalize Order") { Task { await model.serviceAction("finalize-order") } } }
                            if model.service["leadership"]["canAcknowledge"].bool { Button("Acknowledge Order") { Task { await model.serviceAction("acknowledge-order") } } }
                        }
                        Divider()
                        Text("Running order").font(.headline)
                        ForEach(Array(model.service["songs"].array.enumerated()), id: \.element.id) { index, song in
                            HStack(alignment: .top) {
                                Text("\(index + 1)").monospacedDigit().foregroundStyle(.secondary).frame(width: 24)
                                VStack(alignment: .leading, spacing: 4) { Text(song["title"].string); Text(song["reviewed"].bool ? "Reviewed" : "Needs review").font(.caption).foregroundStyle(.secondary) }
                                Spacer()
                                Button("Preview", systemImage: "eye") { Task { await model.run { model.details = try await model.engine.call("service-song-preview", args: [.string(song["songId"].string)]) } } }.labelStyle(.iconOnly)
                            }.padding(.vertical, 5)
                        }
                        if model.service["songs"].array.isEmpty { Text("No songs in this service.").foregroundStyle(.secondary) }
                        if !model.service["notes"].string.isEmpty { Divider(); Text(model.service["notes"].string).textSelection(.enabled) }
                        HStack {
                            Button("Check Readiness") { Task { await model.run { model.details = try await model.engine.call("service-readiness", args: [.string(model.service.id)]) } } }
                            Button("Version History") { Task { await model.run { model.details = try await model.engine.call("service-versions-list", args: [.object(["id": .string(model.service.id)])]) } } }
                            Button("Prepare Offline…") { Task { await model.run { let versions = try await model.engine.call("service-versions-list", args: [.object(["id": .string(model.service.id)])]); offlineVersion = versions["latestApproved"].id; guard !offlineVersion.isEmpty else { throw EngineFailure(message: "Approve a current service version before preparing an offline copy.") }; showOffline = true } } }
                        }
                        ServiceDetails(value: model.details)
                        Text("Running-order edits, packages and rehearsal tools remain available in the existing desktop app while native migration continues.").font(.caption).foregroundStyle(.secondary)
                    }.padding(24).frame(maxWidth: .infinity, alignment: .leading)
                } else { ContentUnavailableView("Choose a service", systemImage: "list.bullet.rectangle", description: Text("Your shared running orders appear here.")) }
            }.frame(minWidth: 320)
        }
        .onChange(of: model.selection) { _, _ in guard let id = model.selection else { return }; model.service = model.rows.first { $0.id == id } ?? .null; model.details = .null }
        .sheet(isPresented: $showOffline, onDismiss: { offlinePassphrase = "" }) {
            VStack(alignment: .leading, spacing: 18) {
                Text("Prepare Offline Copy").font(.title2.bold())
                Text("Protect this read-only service copy with a passphrase of at least 10 characters. Keep the passphrase with your service team.").foregroundStyle(.secondary)
                SecureField("Offline-copy passphrase", text: $offlinePassphrase).textFieldStyle(.roundedBorder)
                HStack {
                    Button("Cancel") { showOffline = false }
                    Spacer()
                    Button("Prepare") {
                        Task {
                            await model.run {
                                let result = try await model.engine.call("service-offline-prepare", args: [.object(["id": .string(model.service.id), "versionId": .string(offlineVersion), "passphrase": .string(offlinePassphrase), "includeAudio": .bool(false)])])
                                if !result["canceled"].bool { model.notice = "Offline copy prepared: \(result["path"].string)"; showOffline = false; offlinePassphrase = "" }
                            }
                        }
                    }.disabled(offlinePassphrase.count < 10 || offlinePassphrase.count > 200 || model.working)
                }
                if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
            }.padding(26).frame(width: 430)
        }
        .sheet(isPresented: $model.showNewService) {
            VStack(alignment: .leading, spacing: 18) {
                Text("New Service").font(.title2.bold())
                TextField("Service name", text: $model.serviceTitle).textFieldStyle(.roundedBorder)
                DatePicker("Schedule", selection: $model.serviceDate)
                HStack { Button("Cancel") { model.showNewService = false }; Spacer(); Button("Create") {
                    let date = model.serviceDate.formatted(.iso8601.year().month().day().dateSeparator(.dash))
                    let formatter = DateFormatter(); formatter.dateFormat = "HH:mm"
                    Task { await model.command("service-plans-change", [.object(["type": .string("create"), "title": .string(model.serviceTitle), "date": .string(date), "time": .string(formatter.string(from: model.serviceDate))])]); if model.error.isEmpty { model.showNewService = false } }
                }.disabled(model.serviceTitle.isEmpty || model.working) }
                if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
            }.padding(26).frame(width: 420)
        }
    }
}
struct ServiceDetails: View {
    let value: JSONValue
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if value != .null {
                Divider()
                if value["checkedAt"].number > 0 { Label(value["ready"].bool ? "Ready" : "Needs attention", systemImage: value["ready"].bool ? "checkmark.circle" : "exclamationmark.triangle") }
                ForEach(value["items"].array.map(EngineRow.init)) { row in VStack(alignment: .leading) { Text(row.value.displayName); Text(row.value["message"].string).font(.caption).foregroundStyle(.secondary) } }
                ForEach(value["versions"].array.map(EngineRow.init)) { row in Text("Revision \(Int(row.value["serviceRevision"].number)) · \(row.value["approvedByLabel"].string)") }
                if !value["text"].string.isEmpty { Text(value["text"].string).textSelection(.enabled) }
                ForEach(Array(value["slides"].array.enumerated()), id: \.offset) { _, slide in Text(slide["text"].string).textSelection(.enabled).padding(.vertical, 6) }
            }
        }
    }
}
