import SwiftUI
import AppKit

struct PairingView: View {
    @Bindable var model: WorkspaceModel
    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                SettingsPaneHeader(
                    title: "Connect this Mac",
                    subtitle: "Pair Stați with your organization to receive files and work with your team.",
                    symbol: "desktopcomputer"
                )
                VStack(alignment: .leading, spacing: 12) {
                    TextField("Computer name", text: $model.name)
                        .textFieldStyle(.roundedBorder)
                    HStack {
                        Spacer()
                        Button("Start Pairing") { Task { await model.startPairing() } }
                            .buttonStyle(.borderedProminent)
                            .disabled(model.working || model.name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    if model.pairing != .null {
                        Divider()
                        VStack(spacing: 12) {
                            QRContent(value: model.pairing)
                            Button("Check Pairing") { Task { await model.checkPairing() } }
                                .disabled(model.working)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .padding(16)
                .background(.quaternary.opacity(0.55), in: .rect(cornerRadius: 12))
            }
            .frame(maxWidth: 620)
            .padding(20)
            .frame(maxWidth: .infinity)
        }
    }
}

struct ProfileView: View {
    @Bindable var model: WorkspaceModel
    var isSheet = false
    @Environment(\.dismiss) private var dismiss
    @FocusState private var pinFocused: Bool
    @State private var pin = ""
    @State private var backupCode = ""
    @State private var showBackupCode = false

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                if let profile = model.pendingProfile, isSheet || !model.showProfile {
                    signInForm(profile)
                } else {
                    Text(isSheet ? "Switch profile" : "Who’s using Stați?")
                        .font(.largeTitle.bold())
                        .accessibilityAddTraits(.isHeader)
                    profileGrid
                }
                if !model.profileError.isEmpty {
                    Label(model.profileError, systemImage: "exclamationmark.circle")
                        .font(.callout)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .textSelection(.enabled)
                }
                if model.pendingProfile != nil || isSheet {
                    Button("Cancel", role: .cancel) {
                        pin = ""
                        if model.pendingProfile != nil { Task { await model.endPendingProfile() } }
                        else { dismiss() }
                    }
                    .keyboardShortcut(.cancelAction)
                    .statiActionStyle()
                    .disabled(model.working)
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 32)
            .frame(maxWidth: 620)
            .frame(maxWidth: .infinity)
        }
        .interactiveDismissDisabled(model.working)
        .onChange(of: model.pendingProfile?.id) { _, _ in pin = "" }
    }

    @ViewBuilder private var profileGrid: some View {
        if model.profileOptions.isEmpty {
            Text("No profiles are available for this Mac.").foregroundStyle(.secondary)
            Button("Refresh Profiles", systemImage: "arrow.clockwise") { Task { await model.refresh() } }
                .statiActionStyle()
                .disabled(model.refreshing)
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 112, maximum: 142), spacing: 14)], spacing: 14) {
                ForEach(model.profileOptions) { profile in
                    ProfileTile(profile: profile, engine: model.engine) {
                        Task { await model.chooseProfile(profile) }
                    }
                }
            }
            .disabled(model.working)
            if model.working { ProgressView().controlSize(.small) }
        }
    }

    private func signInForm(_ profile: StationProfile) -> some View {
        VStack(spacing: 14) {
            OperatorAvatar(profile: profile, engine: model.engine, size: 68)
            Text(profile.name).font(.title.bold()).accessibilityAddTraits(.isHeader)
            if model.awaitingPhone {
                Text(model.awaitingAdministrator
                     ? "Ask an administrator to scan and approve this sign-in."
                     : "Scan with your phone and approve the passkey.")
                    .foregroundStyle(.secondary)
                if model.unlock != .null {
                    QRContent(value: model.unlock)
                    Label("Waiting for approval…", systemImage: "iphone").foregroundStyle(.secondary)
                } else {
                    ProgressView("Preparing sign-in…")
                }
            } else if profile.isAdministrator {
                Text("Enter your Stați account PIN.").foregroundStyle(.secondary)
                SecureField("4-digit account PIN", text: $pin)
                    .textFieldStyle(.roundedBorder)
                    .focused($pinFocused)
                    .frame(width: 230)
                    .disabled(model.working)
                    .onSubmit(submitPIN)
                    .task { pinFocused = true }
                    .onChange(of: pin) { _, value in
                        let digits = String(value.filter { "0123456789".contains($0) }.prefix(4))
                        if digits != value { pin = digits }
                    }
                HStack(spacing: 10) {
                    Button("Use Phone Passkey", systemImage: "iphone") {
                        pin = ""
                        Task { await model.requestPhoneSignIn() }
                    }
                    .statiActionStyle()
                    .disabled(model.working)
                    Button("Sign In", action: submitPIN)
                        .statiActionStyle(prominent: true)
                        .disabled(pin.count != 4 || model.working)
                }
            } else if profile.requiresUnlock {
                if showBackupCode {
                    SecureField("Backup code", text: $backupCode)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 290)
                        .disabled(model.working)
                        .onSubmit(submitBackupCode)
                    HStack(spacing: 10) {
                        Button("Use Phone Passkey", systemImage: "iphone") {
                            showBackupCode = false
                            backupCode = ""
                        }
                        .statiActionStyle()
                        Button("Request Approval", action: submitBackupCode)
                            .statiActionStyle(prominent: true)
                            .disabled(normalizedBackupCode.count != 32 || model.working)
                    }
                } else {
                    Button("Use Phone Passkey", systemImage: "iphone") {
                        Task { await model.requestPhoneSignIn() }
                    }
                    .statiActionStyle(prominent: true)
                    .disabled(model.working)
                    if model.supportsAssistedSignIn {
                        Button("Use Backup Code", systemImage: "key") { showBackupCode = true }
                            .statiActionStyle()
                            .disabled(model.working)
                    }
                }
            } else {
                ProgressView("Signing in…")
            }
        }
        .frame(maxWidth: .infinity)
        .onDisappear {
            backupCode = ""
            showBackupCode = false
        }
    }

    private var normalizedBackupCode: String {
        backupCode.filter { !$0.isWhitespace && $0 != "-" }
    }

    private func submitBackupCode() {
        let submitted = normalizedBackupCode
        guard submitted.count == 32, !model.working else { return }
        backupCode = ""
        Task { await model.requestPhoneSignIn(backupCode: submitted) }
    }

    private func submitPIN() {
        guard pin.count == 4, !model.working else { return }
        let submitted = pin
        pin = ""
        Task {
            await model.submitPIN(submitted)
            if model.pendingProfile != nil { pinFocused = true }
        }
    }
}

private struct ProfileTile: View {
    let profile: StationProfile
    let engine: EngineClient
    let select: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: select) {
            VStack(spacing: 8) {
                OperatorAvatar(profile: profile, engine: engine, size: 64)
                Text(profile.name).font(.headline).lineLimit(2)
                if profile.isAdministrator {
                    Text("Administrator").font(.caption).foregroundStyle(.secondary)
                }
            }
            .multilineTextAlignment(.center)
            .padding(.vertical, 13)
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, minHeight: 126, alignment: .top)
            .background(hovering ? Color.accentColor.opacity(0.12) : Color.secondary.opacity(0.08), in: .rect(cornerRadius: 14))
            .contentShape(.rect(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(profile.name)
        .accessibilityHint(profile.isAdministrator ? "Administrator" : "")
    }
}

struct OperatorAvatar: View {
    let id: String
    let initials: String
    let hasPhoto: Bool
    let engine: EngineClient
    let size: CGFloat
    @State private var image: NSImage?

    init(profile: StationProfile, engine: EngineClient, size: CGFloat) {
        self.init(id: profile.id, initials: profile.initials, hasPhoto: profile.hasPhoto, engine: engine, size: size)
    }

    init(id: String, initials: String, hasPhoto: Bool, engine: EngineClient, size: CGFloat) {
        self.id = id
        self.initials = initials
        self.hasPhoto = hasPhoto
        self.engine = engine
        self.size = size
    }

    var body: some View {
        ZStack {
            Circle().fill(Color.accentColor.opacity(0.16))
            if let image {
                Image(nsImage: image).resizable().scaledToFill()
            } else {
                Text(initials)
                    .font(.system(size: size * 0.34, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
            }
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
        .accessibilityHidden(true)
        .task(id: id + String(hasPhoto)) {
            image = nil
            guard hasPhoto, !id.isEmpty else { return }
            if let value = try? await engine.call("sender-photo", args: [.string(id)]),
               !Task.isCancelled, let separator = value.string.firstIndex(of: ","),
               ["data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64"].contains(String(value.string[..<separator])),
               let data = Data(base64Encoded: String(value.string[value.string.index(after: separator)...])) {
                image = NSImage(data: data)
            }
        }
    }
}

struct QRSheet: View {
    let title: String
    let value: JSONValue
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(spacing: 18) { Text(title).font(.title2.bold()); QRContent(value: value); Button("Done") { dismiss() }.keyboardShortcut(.cancelAction) }.padding(30).frame(minWidth: 340)
    }
}
struct QRContent: View {
    let value: JSONValue
    private var image: NSImage? {
        let qr = value["qr"].string
        guard qr.hasPrefix("data:image/png;base64,"), let data = Data(base64Encoded: String(qr.dropFirst("data:image/png;base64,".count))), data.count <= 1024 * 1024 else { return nil }
        return NSImage(data: data)
    }
    var body: some View {
        VStack(spacing: 12) {
            if let image { Image(nsImage: image).interpolation(.none).resizable().frame(width: 210, height: 210).accessibilityLabel("Scan this QR code with your phone") }
            if !value["code"].string.isEmpty { Text(value["code"].string).font(.system(.title, design: .monospaced)).textSelection(.enabled) }
            if let url = URL(string: value["url"].string), url.scheme == "https" { Link("Open Pairing Link", destination: url) }
            if value["expiresAt"].number > 0 { Text("Expires \(Date(timeIntervalSince1970: value["expiresAt"].number).formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary) }
        }
    }
}
