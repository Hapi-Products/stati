import Foundation
import Security

@MainActor
enum SessionKeychain {
    private static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "org.hapiproducts.stati.ios.session", kSecAttrAccount as String: "stati.ciani01.org"]
    static func load() -> String? {
        var request = query; request[kSecReturnData as String] = true
        var result: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func save(_ value: String?) throws {
        guard let value else { SecItemDelete(query as CFDictionary); return }
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: Data(value.utf8)] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw APIError(status: 0, message: "Your sign-in could not be updated securely.") }
        var request = query; request[kSecValueData as String] = Data(value.utf8)
        request[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(request as CFDictionary, nil) == errSecSuccess else { throw APIError(status: 0, message: "Your sign-in could not be saved securely. Please sign in again.") }
    }
}
