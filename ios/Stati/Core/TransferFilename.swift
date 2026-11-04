import Foundation

/// Keep the chosen wire name equal to the server's Windows-safe filename.
nonisolated enum TransferFilename {
    static func safe(_ original: String) -> String {
        let normalized = original.precomposedStringWithCompatibilityMapping.replacing("\\", with: "/")
        var value = (normalized.components(separatedBy: "/").last ?? "").replacingOccurrences(of: "[<>:\"|?*\\x00-\\x1f\\x7f]", with: "_", options: .regularExpression).replacingOccurrences(of: "[. ]+$", with: "", options: .regularExpression)
        var units = Array(value.utf16.prefix(140))
        if let last = units.last, (0xD800...0xDBFF).contains(last) { units.removeLast() }
        value = String(decoding: units, as: UTF16.self)
        if value.isEmpty || value.range(of: "^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\\.|$)", options: [.regularExpression, .caseInsensitive]) != nil { value = "presentation-" + value }
        return value
    }
}
