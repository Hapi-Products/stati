import UIKit
import AuthenticationServices
import CryptoKit
import Security

@MainActor @Observable
final class MobileSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    var busy = false
    var message = ""
    private var session: ASWebAuthenticationSession?
    private var anchor: ASPresentationAnchor?
    func signIn(store: AppStore) async {
        guard !busy else { return }; busy = true; store.authenticating = true; message = ""
        defer { busy = false; store.authenticating = false; session = nil }
        do {
            guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }) else { throw APIError(status: 0, message: "Open Stați before signing in.") }
            anchor = scene.windows.first(where: \.isKeyWindow) ?? ASPresentationAnchor(windowScene: scene)
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw APIError(status: 0, message: "Secure sign-in is unavailable. Try again.") }
            let verifier = Data(bytes).base64URL
            let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
            let state = UUID().uuidString
            var url = URLComponents(url: store.api.origin.appending(path: "/ios/sign-in"), resolvingAgainstBaseURL: false)!
            url.queryItems = [.init(name: "challenge", value: challenge), .init(name: "state", value: state)]
            let result: URL = try await withCheckedThrowingContinuation { continuation in
                let web = ASWebAuthenticationSession(url: url.url!, callbackURLScheme: "stati-ios") { callback, error in
                    if let callback { continuation.resume(returning: callback) }
                    else { continuation.resume(throwing: error ?? APIError(status: 0, message: "Sign-in was canceled.")) }
                }
                web.presentationContextProvider = self; web.prefersEphemeralWebBrowserSession = false
                session = web
                if !web.start() { continuation.resume(throwing: APIError(status: 0, message: "The secure sign-in sheet could not open.")) }
            }
            guard result.scheme == "stati-ios", result.host == "signin", let parts = URLComponents(url: result, resolvingAgainstBaseURL: false), parts.queryItems?.first(where: { $0.name == "state" })?.value == state, let code = parts.queryItems?.first(where: { $0.name == "code" })?.value else { throw APIError(status: 0, message: "The sign-in response did not match. Start again.") }
            _ = try await store.api.request("/mobile/session", method: "POST", body: .object(["code": .string(code), "verifier": .string(verifier)]))
            await store.refresh()
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin { message = "Sign-in canceled. You can try again." }
        catch { message = error.localizedDescription }
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        guard let anchor else { preconditionFailure("Sign-in must be presented from an active app window.") }
        return anchor
    }
}
extension Data {
    nonisolated var base64URL: String { base64EncodedString().replacing("+", with: "-").replacing("/", with: "_").replacing("=", with: "") }
}
