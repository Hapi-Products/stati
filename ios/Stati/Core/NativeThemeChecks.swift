#if DEBUG && targetEnvironment(simulator)
import UIKit

@MainActor enum NativeThemeChecks {
    static func run() async {
        let safe = await Task.detached(priority: .userInitiated) {
            var samples = 0
            for _ in 0..<20 {
                for name in ["Blue", "Gold", "Green", "Greyscale", "Red"] {
                    let color = AppIconAppearance.adaptiveColor(name)
                    for style in [UIUserInterfaceStyle.light, .dark] {
                        let resolved = color.resolvedColor(with: UITraitCollection(userInterfaceStyle: style))
                        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
                        guard resolved.getRed(&red, green: &green, blue: &blue, alpha: &alpha), alpha == 1 else { return false }
                        samples += 1
                    }
                }
            }
            return samples == 200
        }.value
        let report: [String: Any] = ["checks": ["allIconPalettesResolveOffMainActorWithoutQueueAssertion": safe], "passed": safe, "scope": "Simulator resolves actual dynamic UIColor providers off the main actor, reproducing the crash report's rendering boundary; no physical Worship Team acceptance claim."]
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: URL.applicationSupportDirectory.appending(path: "native-theme-checks.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    }
}
#endif
