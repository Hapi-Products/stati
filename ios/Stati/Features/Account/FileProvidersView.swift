import AuthenticationServices
import SwiftUI

struct FileProvidersSection: View {
    var body: some View {
        Section {
            NavigationLink { FileProvidersView() } label: {
                Label("File Providers", systemImage: "externaldrive")
            }
        }
    }
}

private struct FileProvidersView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var selectedComputer = ""
    @State private var settings = JSONValue.null
    @State private var message = ""
    @State private var busy = false
    @State private var drivePicker = GoogleDrivePicker()
    @State private var editingMember: APIRecord?
    @State private var removingAccount: APIRecord?
    @State private var removingFolder = false

    private var computerID: String {
        for id in [selectedComputer, store.selectedComputer] where store.computers.contains(where: { $0.id == id }) {
            return id
        }
        return store.computers.first?.id ?? ""
    }
    private var folderName: String { settings["folderName"].text }
    private var accounts: [APIRecord] { settings["accounts"].records }
    private var accountLimit: Int { Int(settings["accountLimit"].number) }
    private var canManage: Bool {
        UIDevice.current.userInterfaceIdiom == .phone && store.isAdmin && settings["canManage"].flag
    }

    var body: some View {
        Form {
            if computerID.isEmpty {
                ContentUnavailableView("No presentation computers", systemImage: "desktopcomputer",
                                       description: Text("Connect to a computer to set up Google Drive."))
            } else {
                Picker("Presentation computer", selection: Binding(get: { computerID }, set: { selectedComputer = $0 })) {
                    ForEach(store.computers) { Text($0["name"].text).tag($0.id) }
                }
                .disabled(busy)
                if !message.isEmpty { NoticeView(text: message) }
                if settings == .null {
                    if message.isEmpty { ProgressView("Loading file providers…") }
                    else { Button("Try Again", systemImage: "arrow.clockwise") { Task { await load() } } }
                } else {
                    accountSection
                    if canManage { managementSections }
                }
            }
        }
        .navigationTitle("File Providers")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: computerID) {
            settings = .null
            message = ""
            if !computerID.isEmpty { await load() }
        }
        .refreshable { if !computerID.isEmpty && !busy { await load() } }
        .onChange(of: store.accountEpoch) { dismiss() }
        .onDisappear { drivePicker.cancel() }
        .sheet(item: $editingMember) { member in
            DriveLimitEditor(member: member, maximum: Int(settings["maxAccountLimit"].number)) { limit in
                await update(["action": .string("set-limit"), "userId": .string(member.id),
                              "accountLimit": .number(Double(limit))])
            }
        }
        .confirmationDialog("Disconnect the Drive folder?", isPresented: $removingFolder, titleVisibility: .visible) {
            Button("Disconnect Folder", role: .destructive) { Task { _ = await update(["action": .string("disconnect")]) } }
        } message: {
            Text("Google Drive imports for this computer will pause until you approve a folder. Existing song requests stay available.")
        }
        .alert("Remove Google account?", isPresented: Binding(
            get: { removingAccount != nil },
            set: { if !$0 { removingAccount = nil } }
        ), presenting: removingAccount) { account in
            Button("Remove", role: .destructive) {
                Task { _ = await update(["action": .string("remove"), "id": .string(account.id)], accounts: true) }
            }
        } message: { _ in
            Text("This frees an account slot for this computer.")
        }
    }

    private var accountSection: some View {
        Section {
            ForEach(accounts) { account in
                HStack {
                    Label(account["label"].text, systemImage: "person.crop.circle")
                    Spacer()
                    Button("Remove account", systemImage: "minus.circle", role: .destructive) {
                        removingAccount = account
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .frame(minWidth: 44, minHeight: 44)
                }
            }
            if settings["canImport"].flag {
                Button("Add Google Account", systemImage: "plus.circle") { Task { await chooseFolder(forApproval: false) } }
                    .disabled(accounts.count >= accountLimit)
            }
        } header: {
            Text("Google Drive")
        } footer: {
            if !settings["configured"].flag {
                Text("Google Drive setup is pending on the Stați server.")
            } else if settings["canImport"].flag {
                Text("\(accounts.count) of \(accountLimit) accounts linked. When adding an account, select the approved folder \(folderName).")
            } else {
                Text("An administrator can approve Drive access in Stați on iPhone.")
            }
        }
        .disabled(busy)
    }

    @ViewBuilder private var managementSections: some View {
        Section {
            if !folderName.isEmpty {
                LabeledContent("Approved folder", value: folderName)
            }
            if settings["configured"].flag {
                Button(folderName.isEmpty ? "Approve Drive Folder" : "Change Drive Folder", systemImage: "folder") {
                    Task { await chooseFolder(forApproval: true) }
                }
            }
            if !folderName.isEmpty {
                Button("Disconnect Folder", systemImage: "link.badge.minus", role: .destructive) { removingFolder = true }
            }
        } header: {
            Text("Folder Approval")
        } footer: {
            Text("Choose a shared folder named stati-music, stati-folder, or stati.")
        }
        .disabled(busy)

        if !folderName.isEmpty {
            Section {
                ForEach(settings["members"].records) { member in
                    Button {
                        editingMember = member
                    } label: {
                        LabeledContent(member["name"].text) {
                            let limit = Int(member["accountLimit"].number)
                            if limit == 0 { Text("Off") }
                            else { Text("\(Int(member["linkedAccounts"].number)) of \(limit) linked") }
                            Image(systemName: "chevron.right").font(.footnote).accessibilityHidden(true)
                        }
                        .foregroundStyle(.primary)
                    }
                }
            } header: { Text("Member Access") } footer: {
                Text("Choose how many Google accounts each person can use with this computer. Set the limit to zero to turn off access.")
            }
            .disabled(busy)
        }
    }

    private func path(_ id: String, accounts: Bool = false) -> String {
        "/computers/" + id + "/google-drive" + (accounts ? "/accounts" : "")
    }

    private func load() async {
        let id = computerID
        let epoch = store.accountEpoch
        do {
            let result = try await store.api.request(path(id))
            guard current(id, epoch), !Task.isCancelled else { return }
            settings = result
            message = ""
        } catch is CancellationError { }
        catch { if current(id, epoch) { message = error.localizedDescription } }
    }

    private func current(_ id: String, _ epoch: UUID) -> Bool {
        computerID == id && store.accountEpoch == epoch
    }

    private func chooseFolder(forApproval: Bool) async {
        guard !busy, !computerID.isEmpty else { return }
        let id = computerID
        let epoch = store.accountEpoch
        busy = true
        defer { busy = false }
        do {
            var proof = try await drivePicker.choose(folder: true, configuration: settings, origin: store.api.origin)
            guard current(id, epoch) else { return }
            proof["action"] = .string("connect")
            _ = await save(proof, computer: id, epoch: epoch, accounts: !forApproval)
        } catch is CancellationError { }
        catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin { }
        catch { if current(id, epoch) { message = error.localizedDescription } }
    }

    private func update(_ fields: [String: JSONValue], accounts: Bool = false) async -> String? {
        guard !busy, !computerID.isEmpty else { return "The presentation computer is unavailable." }
        busy = true
        defer { busy = false }
        return await save(fields, computer: computerID, epoch: store.accountEpoch, accounts: accounts)
    }

    private func save(_ fields: [String: JSONValue], computer id: String, epoch: UUID, accounts: Bool) async -> String? {
        var request = fields
        request["revision"] = settings["revision"]
        do {
            let result = try await store.api.request(path(id, accounts: accounts), method: "POST", body: .object(request))
            guard current(id, epoch) else { return "The presentation computer changed." }
            settings = result
            message = ""
            return nil
        } catch {
            if current(id, epoch) {
                await load()
                if current(id, epoch) { message = error.localizedDescription }
            }
            return error.localizedDescription
        }
    }
}

private struct DriveLimitEditor: View {
    @Environment(\.dismiss) private var dismiss
    let member: APIRecord
    let maximum: Int
    let save: (Int) async -> String?
    @State private var limit: Int
    @State private var saving = false
    @State private var message = ""

    init(member: APIRecord, maximum: Int, save: @escaping (Int) async -> String?) {
        self.member = member
        self.maximum = maximum
        self.save = save
        _limit = State(initialValue: Int(member["accountLimit"].number))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Stepper(value: $limit, in: 0...maximum) {
                        LabeledContent("Account limit", value: limit == 0 ? "Off" : String(limit))
                    }
                    .disabled(saving)
                    if !message.isEmpty { NoticeView(text: message) }
                } footer: {
                    if limit < Int(member["linkedAccounts"].number) {
                        Text("Saving this limit will remove the most recently linked accounts that exceed it.")
                    }
                }
            }
            .navigationTitle(member["name"].text)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }.labelStyle(.iconOnly).disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", systemImage: "checkmark") {
                        Task {
                            saving = true
                            if let error = await save(limit) { message = error }
                            else { dismiss() }
                            saving = false
                        }
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderedProminent)
                    .disabled(saving || limit == Int(member["accountLimit"].number))
                }
            }
            .interactiveDismissDisabled(saving)
        }
    }
}
