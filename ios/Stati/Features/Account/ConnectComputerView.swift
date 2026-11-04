import SwiftUI
import AVFoundation
import VisionKit

struct ConnectComputerView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var cameraAllowed = false
    @State private var code = ""
    @State private var message = ""
    @State private var busy = false
    @State private var finished = false
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                if finished { ContentUnavailableView("Computer request sent", systemImage: "checkmark.circle", description: Text(message)) }
                else {
                    if cameraAllowed && DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                        NativeComputerScanner(active: phase == .active && !busy, detected: receive, failed: { message = $0 }).frame(maxHeight: .infinity).clipShape(.rect(cornerRadius: 16)).accessibilityLabel("Scan a Stați computer QR code")
                    } else { ContentUnavailableView("Scan a computer code", systemImage: "qrcode.viewfinder", description: Text(cameraAllowed ? "Enter the six-digit code shown on the computer." : "Allow camera access to scan, or enter the computer code below.")) }
                    if AVCaptureDevice.authorizationStatus(for: .video) == .denied {
                        Link("Camera settings", destination: URL(string: UIApplication.openSettingsURLString)!).frame(minHeight: 44)
                    }
                    HStack(spacing: 12) {
                        TextField("Computer code", text: $code).keyboardType(.numberPad).textContentType(.oneTimeCode).monospacedDigit().padding(.horizontal, 16).frame(minHeight: 44).glassEffect(.regular, in: .capsule).onChange(of: code) { code = String(code.filter { $0.isASCII && $0.isNumber }.prefix(6)) }.accessibilityLabel("Six-digit computer code")
                        Button("Connect", systemImage: "checkmark") { receive(code) }.labelStyle(ActionIconLabelStyle()).frame(width: 44, height: 44).buttonStyle(.glass).buttonBorderShape(.circle).disabled(code.count != 6 || busy)
                    }
                    if busy { ProgressView("Connecting…") }
                    if !message.isEmpty { NoticeView(text: message) }
                }
            }.padding(20).navigationTitle("Add computer").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close scanner", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle()) } }
        }.onChange(of: phase) { _, value in if value == .active { cameraAllowed = AVCaptureDevice.authorizationStatus(for: .video) == .authorized } }.task {
            #if DEBUG && targetEnvironment(simulator)
            if NativeReview.route != nil { return }
            #endif
            cameraAllowed = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
            if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined { cameraAllowed = await AVCaptureDevice.requestAccess(for: .video) }
        }
    }
    private func receive(_ value: String) {
        guard !busy, !finished else { return }
        guard let target = ComputerScanTarget(value) else { message = "Scan a Stați computer QR code, or enter its six-digit code."; return }
        busy = true; message = ""
        let owner = store.me?.id, epoch = store.accountEpoch
        Task { @MainActor in
            defer { busy = false }
            do {
                guard owner != nil else { throw APIError(status: 401, message: "Sign in before connecting a computer.") }
                let connection: String
                switch target {
                case .code(let code):
                    let value = try await store.api.request("/access", method: "POST", body: .object(["code": .string(code)]))
                    guard let id = UUID(uuidString: value["deviceId"].text) else { throw APIError(status: 409, message: "The computer could not be verified. Try its current QR code.") }
                    connection = "device:" + id.uuidString.lowercased()
                case .receiver(let token): connection = token
                }
                try Task.checkCancellation(); guard owner == store.me?.id, epoch == store.accountEpoch, store.api.signedIn else { return }
                let receipt = try await store.api.request("/connections/" + connection, method: "POST")
                try Task.checkCancellation(); guard owner == store.me?.id, epoch == store.accountEpoch else { return }
                let status = receipt["connection"]["status"].text
                guard ["approved", "pending", "denied"].contains(status) else { throw APIError(status: 409, message: "The connection was not confirmed. Try again.") }
                message = status == "approved" ? "You are connected to the computer." : status == "pending" ? "Wait for an administrator or computer operator to approve your access." : "Access was declined. Contact your administrator."
                finished = true; await store.refresh()
            } catch { if owner == store.me?.id, epoch == store.accountEpoch { message = error.localizedDescription } }
        }
    }
}
