import CryptoKit
import Darwin
import Foundation

enum ComputerScanTarget: Equatable {
    case code(String)
    case receiver(String)
    case pairing(String)
    init?(_ value: String) {
        if value.count == 6, value.utf8.allSatisfy({ (48...57).contains($0) }) { self = .code(value); return }
        guard let url = URLComponents(string: value), url.scheme == "https", url.host == "stati.ciani01.org", url.user == nil, url.password == nil, url.port == nil, url.query == nil else { return nil }
        if ["", "/", "/join"].contains(url.path), let fragment = url.fragment, fragment.hasPrefix("join="), let target = ComputerScanTarget(String(fragment.dropFirst(5))), case .code = target { self = target; return }
        if url.path.hasPrefix("/send/"), url.fragment == nil {
            let token = String(url.path.dropFirst(6))
            guard (12...128).contains(token.count), token.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || [45,95].contains($0) }) else { return nil }
            self = .receiver(token); return
        }
        if url.path.hasPrefix("/pair/"), url.fragment == nil {
            let token = String(url.path.dropFirst(6))
            guard (16...50).contains(token.count), token.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || [45,95].contains($0) }) else { return nil }
            self = .pairing(token); return
        }
        return nil
    }
}

struct Ilumin8ClickerLink {
    let url: URL
    let computerAddress: String
    let stationID: String?

    init?(_ value: String) {
        guard let parts = value.wholeMatch(of: #/https:\/\/(([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::([0-9]{1,5}))?)\/remote(?:\?stati=([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}))?#[0-9a-f]{48}/#),
              Self.isValidHost(parts.2),
              parts.3.map({ (1...65535).contains(Int($0) ?? 0) }) ?? true,
              let url = URL(string: value) else { return nil }
        self.url = url
        computerAddress = String(parts.1)
        stationID = parts.4.map(String.init)
    }

    var binding: String? {
        guard let code = url.fragment else { return nil }
        return SHA256.hash(data: Data(code.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func sharingProfile(ticket: String) -> URL? {
        guard ticket.wholeMatch(of: #/[A-Za-z0-9_-]{43}/#) != nil else { return nil }
        return URL(string: url.absoluteString + "?profile=" + ticket)
    }

    private static func isValidHost(_ host: Substring) -> Bool {
        if host.hasPrefix("[") {
            var address = in6_addr()
            return inet_pton(AF_INET6, String(host.dropFirst().dropLast()), &address) == 1
        }
        if host.wholeMatch(of: #/(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?/#) != nil {
            return host.count <= 253
        }
        var address = in_addr()
        return inet_pton(AF_INET, String(host), &address) == 1
    }
}
