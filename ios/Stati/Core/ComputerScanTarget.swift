import Foundation

enum ComputerScanTarget: Equatable {
    case code(String)
    case receiver(String)
    init?(_ value: String) {
        if value.count == 6, value.utf8.allSatisfy({ (48...57).contains($0) }) { self = .code(value); return }
        guard let url = URLComponents(string: value), url.scheme == "https", url.host == "stati.ciani01.org", url.user == nil, url.password == nil, url.port == nil, url.query == nil else { return nil }
        if ["", "/", "/join"].contains(url.path), let fragment = url.fragment, fragment.hasPrefix("join="), let target = ComputerScanTarget(String(fragment.dropFirst(5))), case .code = target { self = target; return }
        if url.path.hasPrefix("/send/"), url.fragment == nil {
            let token = String(url.path.dropFirst(6))
            guard (12...128).contains(token.count), token.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || [45,95].contains($0) }) else { return nil }
            self = .receiver(token); return
        }
        return nil
    }
}
