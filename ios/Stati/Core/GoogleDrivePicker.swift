import AuthenticationServices
import CryptoKit
import Security
import UIKit

@MainActor
final class GoogleDrivePicker: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum Selection {
        case file
        case folder
        case approvedFolder(String)
    }

    private var session: ASWebAuthenticationSession?
    private var anchor: ASPresentationAnchor?

    func choose(_ selection: Selection, configuration: JSONValue, origin: URL) async throws -> [String: JSONValue] {
        guard configuration["configured"].flag,
              configuration["clientId"].text.hasSuffix(".apps.googleusercontent.com"),
              configuration["redirectURI"].text == origin.appending(path: "/api/google-drive/callback").absoluteString,
              let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }),
              let window = scene.windows.first(where: \.isKeyWindow) else {
            throw APIError(status: 0, message: "Google Drive is unavailable. Open Stați and try again.")
        }
        guard session == nil else { throw CancellationError() }
        let verifier = try randomValue()
        let state = try randomValue()
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        var url = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        var parameters = [
            "client_id": configuration["clientId"].text,
            "redirect_uri": configuration["redirectURI"].text,
            "response_type": "code",
            "scope": "https://www.googleapis.com/auth/drive.file",
            "prompt": "consent select_account",
            "trigger_onepick": "true",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        ]
        switch selection {
        case .file: break
        case .folder, .approvedFolder:
            parameters["allow_folder_selection"] = "true"
            parameters["mimetypes"] = "application/vnd.google-apps.folder"
        }
        if case let .approvedFolder(id) = selection {
            parameters["file_ids"] = id
        }
        url.queryItems = parameters.map { URLQueryItem(name: $0.key, value: $0.value) }
        anchor = window
        defer { session = nil; anchor = nil }
        let callback: URL = try await withCheckedThrowingContinuation { result in
            let session = ASWebAuthenticationSession(url: url.url!, callbackURLScheme: "stati-ios") { url, error in
                if let url { result.resume(returning: url) }
                else { result.resume(throwing: error ?? CancellationError()) }
            }
            session.presentationContextProvider = self
            self.session = session
            if !session.start() {
                result.resume(throwing: APIError(status: 0, message: "The Google Drive picker could not open. Try again."))
            }
        }
        try Task.checkCancellation()
        let parts = URLComponents(url: callback, resolvingAgainstBaseURL: false)
        let query = parts?.queryItems ?? []
        guard parts?.scheme == "stati-ios", parts?.host == "google-drive",
              query.first(where: { $0.name == "state" })?.value == state else {
            throw APIError(status: 0, message: "The Google Drive response did not match. Choose the item again.")
        }
        if query.first(where: { $0.name == "error" })?.value == "access_denied" { throw CancellationError() }
        guard let code = query.first(where: { $0.name == "code" })?.value,
              let fileID = query.first(where: { $0.name == "fileId" })?.value else {
            throw APIError(status: 0, message: "Google Drive did not confirm an item. Choose it again.")
        }
        return ["code": .string(code), "fileId": .string(fileID), "verifier": .string(verifier)]
    }

    func cancel() { session?.cancel() }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        guard let anchor else { preconditionFailure("The Drive picker needs an active app window.") }
        return anchor
    }

    private func randomValue() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw APIError(status: 0, message: "Secure Google Drive access is unavailable. Try again.")
        }
        return Data(bytes).base64URL
    }
}
