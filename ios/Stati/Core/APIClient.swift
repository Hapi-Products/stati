import Foundation
import CryptoKit

@MainActor
final class APIClient {
    let origin = URL(string: "https://stati.ciani01.org")!
    private var cookie: String?
    init() {
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route != nil { cookie = "simulator-review-only"; return }
        #endif
        cookie = SessionKeychain.load()
    }
    private var generation = 0
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route != nil { configuration.protocolClasses = [NativeReviewProtocol.self] }
        #endif
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.timeoutIntervalForRequest = 45
        configuration.timeoutIntervalForResource = 300
        return URLSession(configuration: configuration)
    }()
    var signedIn: Bool { cookie != nil }
    var sessionFingerprint: String { cookie.map { SHA256.hash(data: Data($0.utf8)).map { String(format: "%02x", $0) }.joined() } ?? "" }
    func clearSession() {
        generation += 1; cookie = nil
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route != nil { return }
        #endif
        try? SessionKeychain.save(nil)
    }
    func url(_ path: String) -> URL { URL(string: path.hasPrefix("/api/") ? path : "/api" + path, relativeTo: origin)!.absoluteURL }
    func taskEventSocket() -> URLSessionWebSocketTask {
        var components = URLComponents(url: url("/tasks/events"), resolvingAgainstBaseURL: true)!
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        var request = URLRequest(url: components.url!)
        request.setValue(origin.absoluteString, forHTTPHeaderField: "Origin")
        if let cookie { request.setValue("stati_session=" + cookie, forHTTPHeaderField: "Cookie") }
        return session.webSocketTask(with: request)
    }
    func request(_ path: String, method: String = "GET", body: JSONValue? = nil) async throws -> JSONValue {
        let data = try body.map { try JSONEncoder().encode($0) }
        let bytes = try await bytes(path, method: method, body: data, headers: body == nil ? [:] : ["Content-Type": "application/json"])
        return try JSONDecoder().decode(JSONValue.self, from: bytes)
    }
    func upload(_ path: String, file: URL, headers: [String: String]) async throws -> Data {
        try await bytes(path, method: "POST", headers: headers, file: file)
    }
    func bytes(_ path: String, method: String = "GET", body: Data? = nil, headers: [String: String] = [:], file: URL? = nil) async throws -> Data {
        let scope = generation
        var request = URLRequest(url: url(path)); request.httpMethod = method; request.httpBody = body
        request.setValue(origin.absoluteString, forHTTPHeaderField: "Origin")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let cookie { request.setValue("stati_session=" + cookie, forHTTPHeaderField: "Cookie") }
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        let (data, response): (Data, URLResponse)
        if let file { (data, response) = try await session.upload(for: request, fromFile: file) }
        else { (data, response) = try await session.data(for: request) }
        try Task.checkCancellation()
        guard scope == generation else { throw CancellationError() }
        guard let http = response as? HTTPURLResponse else { throw APIError(status: 0, message: "The server did not respond. Try again.") }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(JSONValue.self, from: data))?["error"].text ?? ""
            throw APIError(status: http.statusCode, message: message.isEmpty ? "Stați could not complete this request (\(http.statusCode)). Try again." : message)
        }
        let responseHeaders = http.allHeaderFields.reduce(into: [String: String]()) { if let key = $1.key as? String, let value = $1.value as? String { $0[key] = value } }
        for value in HTTPCookie.cookies(withResponseHeaderFields: responseHeaders, for: origin) where value.name == "stati_session" {
            try SessionKeychain.save(value.value); if cookie != value.value { generation += 1 }; cookie = value.value
        }
        return data
    }
}
