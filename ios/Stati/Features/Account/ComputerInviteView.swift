import SwiftUI
import CoreImage.CIFilterBuiltins

struct ComputerInviteView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    let computer: APIRecord
    @State private var code = ""
    @State private var image: UIImage?
    @State private var validUntil = Date.distantPast
    @State private var message = ""
    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                Text(computer.name).font(.headline)
                if store.isAdmin {
                    TimelineView(.periodic(from: .now, by: 1)) { clock in
                        if clock.date < validUntil, let image {
                            VStack(spacing: 20) {
                                Image(uiImage: image).interpolation(.none).resizable().scaledToFit().frame(maxWidth: 260).padding(20).background(.white, in: .rect(cornerRadius: 16)).accessibilityLabel("Scan to join Stați")
                                Text(code).font(.largeTitle.monospacedDigit().bold()).textSelection(.enabled).accessibilityLabel("Joining code " + code.map(String.init).joined(separator: " "))
                                Text("New code in \(max(0, Int(ceil(validUntil.timeIntervalSince(clock.date)))))s").font(.callout.monospacedDigit()).foregroundStyle(Color.statiSecondary)
                            }
                        } else if message.isEmpty { ProgressView("Getting joining code…").frame(minHeight: 240) }
                    }
                    Text("Scan the QR code or enter this code to create an account. An administrator still approves new members.").foregroundStyle(Color.statiSecondary).multilineTextAlignment(.center)
                    if !message.isEmpty { NoticeView(text: message); Button("Try again", systemImage: "arrow.clockwise") { Task { await refresh() } } }
                } else { ContentUnavailableView("Administrator access required", systemImage: "lock") }
            }.padding(24).frame(maxWidth: 460).frame(maxWidth: .infinity)
        }.navigationTitle("Invite members").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Close invite", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle()) } }
            .task(id: phase) {
                guard phase == .active else { code = ""; image = nil; return }
                while !Task.isCancelled && store.isAdmin {
                    await refresh()
                    do { try await Task.sleep(for: .seconds(max(2, validUntil.timeIntervalSinceNow))) } catch { return }
                    if !message.isEmpty { return }
                }
            }
            .onChange(of: store.isAdmin) { _, admin in if !admin { code = ""; image = nil; validUntil = .distantPast } }
    }
    private func refresh() async {
        let owner = store.me?.id, epoch = store.accountEpoch
        guard store.isAdmin, owner != nil else { return }
        do {
            let result = try await store.api.request("/devices/" + computer.id + "/enrollment-code")
            try Task.checkCancellation()
            guard store.isAdmin, store.me?.id == owner, store.accountEpoch == epoch else { return }
            let value = result["code"].text
            guard value.count == 6, value.allSatisfy(\.isNumber), let url = URL(string: result["url"].text), url.scheme == "https", url.host == "stati.ciani01.org", url.fragment == "join=" + value else { throw APIError(status: 409, message: "The joining code could not be verified. Try again.") }
            let filter = CIFilter.qrCodeGenerator(); filter.message = Data(url.absoluteString.utf8); filter.correctionLevel = "M"
            guard let output = filter.outputImage, let cg = CIContext().createCGImage(output, from: output.extent) else { throw APIError(status: 500, message: "The QR code could not be prepared.") }
            code = value; image = UIImage(cgImage: cg); validUntil = .now.addingTimeInterval(max(0, result["expiresAt"].number - result["serverTime"].number)); message = ""
        } catch is CancellationError { }
        catch { code = ""; image = nil; validUntil = .distantPast; message = error.localizedDescription }
    }
}
