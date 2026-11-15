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
    private var members: [APIRecord] { settings["members"].records }
    private var accountLimit: Int { Int(settings["accountLimit"].number) }
    private var driveAvailable: Bool { settings["configured"].flag }
    private var canImport: Bool { settings["canImport"].flag }
    private var canManage: Bool {
        UIDevice.current.userInterfaceIdiom == .phone && store.isAdmin && settings["canManage"].flag
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("File Providers")
                    .font(.system(.largeTitle, design: .serif))
                    .accessibilityAddTraits(.isHeader)
                if computerID.isEmpty {
                    ContentUnavailableView("No presentation computers", systemImage: "desktopcomputer",
                                           description: Text("Connect to a computer to set up Google Drive."))
                } else {
                    computerPicker
                    if settings == .null {
                        if message.isEmpty { ProgressView("Loading file providers…") }
                        else {
                            driveNotice
                            Button("Try Again", systemImage: "arrow.clockwise") { Task { await load() } }
                        }
                    } else {
                        driveCard
                        if canImport || !accounts.isEmpty { accountSection }
                        if canManage && !members.isEmpty { memberSection }
                    }
                }
            }
            .frame(maxWidth: 560, alignment: .leading)
            .padding(.horizontal, 22)
            .padding(.top, 14)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity)
        }
        .background(alignment: .top) {
            FileProvidersBackdrop()
                .ignoresSafeArea(edges: .top)
        }
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

    private var computerPicker: some View {
        Menu {
            Picker("Presentation computer", selection: Binding(get: { computerID }, set: { selectedComputer = $0 })) {
                ForEach(store.computers) { Text($0["name"].text).tag($0.id) }
            }
        } label: {
            HStack(spacing: 9) {
                Image(systemName: "desktopcomputer")
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Presentation computer").font(.caption).foregroundStyle(.secondary)
                    Text(store.computers.first { $0.id == computerID }?["name"].text ?? "")
                        .font(.subheadline.weight(.semibold))
                }
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2.weight(.semibold))
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(minHeight: 44)
            .background(.thinMaterial, in: .rect(cornerRadius: 14))
        }
        .foregroundStyle(.primary)
        .disabled(busy)
    }

    private var driveCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "externaldrive")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .background(AppIconAppearance.shared.fill, in: .rect(cornerRadius: 13))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Google Drive")
                        .font(.title3.bold())
                        .accessibilityAddTraits(.isHeader)
                    if !folderName.isEmpty {
                        Label(folderName, systemImage: "folder")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    } else {
                        Text(driveAvailable ? "No folder approved" : "Setup pending")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if canManage && !folderName.isEmpty { driveOptions }
            }
            if !message.isEmpty { driveNotice }
            if busy {
                ProgressView("Updating Google Drive…")
                    .font(.footnote)
            } else if canManage && driveAvailable && folderName.isEmpty {
                Text("Choose a shared folder named stati-music, stati-folder, or stati.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                driveButton("Approve Drive Folder", icon: "folder.badge.plus", forApproval: true)
            } else if canImport {
                driveButton("Add Google Account", icon: "plus", forApproval: false)
                    .disabled(accounts.count >= accountLimit)
            } else if driveAvailable && !canManage {
                Text("Ask an administrator to approve your access on iPhone.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .background(.regularMaterial, in: .rect(cornerRadius: 23))
        .overlay {
            RoundedRectangle(cornerRadius: 23).strokeBorder(.primary.opacity(0.1), lineWidth: 1)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    private var driveNotice: some View {
        Label(message, systemImage: "exclamationmark.circle")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func driveButton(_ title: String, icon: String, forApproval: Bool) -> some View {
        Button {
            Task { await chooseFolder(forApproval: forApproval) }
        } label: {
            Label(title, systemImage: icon)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.roundedRectangle(radius: 13))
        .controlSize(.large)
        .tint(AppIconAppearance.shared.fill)
        .foregroundStyle(.white)
    }

    private var driveOptions: some View {
        Menu {
            if driveAvailable {
                Button("Change Drive Folder", systemImage: "folder") { Task { await chooseFolder(forApproval: true) } }
            }
            Button("Disconnect Folder", systemImage: "link.badge.minus", role: .destructive) { removingFolder = true }
        } label: {
            Label("Google Drive options", systemImage: "ellipsis")
                .labelStyle(.iconOnly)
                .frame(width: 44, height: 44)
        }
        .disabled(busy)
    }

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Google Accounts").font(.headline).accessibilityAddTraits(.isHeader)
            if canImport {
                Text("\(accounts.count) of \(accountLimit) linked")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            ForEach(accounts) { account in
                Divider()
                HStack(spacing: 8) {
                    Label(account["label"].text, systemImage: "person.crop.circle")
                        .font(.subheadline)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button("Remove account", systemImage: "minus.circle", role: .destructive) {
                        removingAccount = account
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .frame(minWidth: 44, minHeight: 44)
                }
            }
        }
        .disabled(busy)
    }

    private var memberSection: some View {
        LazyVStack(alignment: .leading, spacing: 4) {
            Text("Member Access")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                .padding(.bottom, 4)
            ForEach(members) { member in
                Divider()
                Button {
                    editingMember = member
                } label: {
                    LabeledContent(member["name"].text) {
                        let limit = Int(member["accountLimit"].number)
                        if limit == 0 { Text("Off") }
                        else { Text("\(Int(member["linkedAccounts"].number)) of \(limit) linked") }
                        Image(systemName: "chevron.right").font(.caption).accessibilityHidden(true)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .disabled(busy)
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
        let selection: GoogleDrivePicker.Selection
        if forApproval {
            selection = .folder
        } else {
            let folderID = settings["approvedFolderId"].text
            guard !folderID.isEmpty else {
                message = "Pull down to refresh the approved Drive folder and try again."
                return
            }
            selection = .approvedFolder(folderID)
        }
        let id = computerID
        let epoch = store.accountEpoch
        busy = true
        defer { busy = false }
        do {
            var proof = try await drivePicker.choose(selection, configuration: settings, origin: store.api.origin)
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

private struct FileProvidersBackdrop: View {
    var body: some View {
        ZStack(alignment: .top) {
            Color(uiColor: .systemBackground)
            ZStack {
                RadialGradient(colors: [AppIconAppearance.shared.accent.opacity(0.2), .clear],
                               center: .topTrailing, startRadius: 12, endRadius: 420)
                Canvas { context, size in
                    var grid = Path()
                    for x in stride(from: 0.0, to: size.width, by: 40) {
                        grid.move(to: CGPoint(x: x, y: 0))
                        grid.addLine(to: CGPoint(x: x, y: size.height))
                    }
                    for y in stride(from: 0.0, to: size.height, by: 40) {
                        grid.move(to: CGPoint(x: 0, y: y))
                        grid.addLine(to: CGPoint(x: size.width, y: y))
                    }
                    context.stroke(grid, with: .color(.primary.opacity(0.065)), lineWidth: 0.5)
                }
            }
            .frame(height: 430)
            .mask(LinearGradient(colors: [.black, .black, .clear], startPoint: .top, endPoint: .bottom))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
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
