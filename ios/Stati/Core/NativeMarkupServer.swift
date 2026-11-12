#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor enum NativeMarkupServer {
    static var content = NativeReviewMaterial.pdf
    static var receipts: [String: JSONValue] = [:]
    static var putCount = 0
    static var loseNextReply = false
    static func requestBody(_ request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open(); defer { stream.close() }
        var data = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
        while data.count <= 1024 * 1024 {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 { return nil }; if count == 0 { return data }
            data.append(buffer, count: count)
        }
        return nil
    }
    static func respond(_ request: URLRequest) -> (status: Int, body: JSONValue) {
        if request.httpMethod == "GET" {
            let intent = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "intent" })?.value ?? ""
            return (200, .object(["canEdit": .bool(true), "file": .object(["sha256": .string(FileMarkupStorage.digest(content))]), "edit": receipts[intent] ?? .null]))
        }
        guard request.httpMethod == "PUT", let bytes = requestBody(request) else { return (400, .object(["error": .string("Invalid fixture request")])) }
        let id = request.value(forHTTPHeaderField: "X-Edit-ID") ?? ""
        if let receipt = receipts[id] { return (200, receipt) }
        guard request.value(forHTTPHeaderField: "X-Base-SHA256") == FileMarkupStorage.digest(content), request.value(forHTTPHeaderField: "X-Content-SHA256") == FileMarkupStorage.digest(bytes) else { return (409, .object(["error": .string("Fixture version conflict")])) }
        putCount += 1; content = bytes
        let receipt: JSONValue = .object(["ok": .bool(true), "state": .string("committed"), "id": .string(id), "targetKind": .string("group"), "targetId": .string(NativeReviewMaterial.id), "baseSha256": .string(request.value(forHTTPHeaderField: "X-Base-SHA256") ?? ""), "sha256": .string(FileMarkupStorage.digest(bytes)), "filename": .string((request.value(forHTTPHeaderField: "X-Filename") ?? "").removingPercentEncoding ?? ""), "bytes": .number(Double(bytes.count))])
        receipts[id] = receipt
        if loseNextReply { loseNextReply = false; return (503, .object(["error": .string("Fixture accepted edit; reply lost")])) }
        return (200, receipt)
    }
}
#endif
