#if DEBUG && targetEnvironment(simulator)
import SwiftUI

@MainActor enum NativeOwnerHostingChecks {
    static func run(store: AppStore) {
        // UIKit-hosted header/preview labels must not depend on inherited observable context.
        let account = UIHostingController(rootView: IPadAccountButton(store: store, open: {}))
        account.view.frame = CGRect(x: 0, y: 0, width: 320, height: 64)
        account.view.setNeedsLayout(); account.view.layoutIfNeeded()
        let thumbnail = UIHostingController(rootView: IPadSharedFileTile(store: store, file: APIRecord(raw: NativeReviewMaterial.file.fields)))
        thumbnail.view.frame = CGRect(x: 0, y: 0, width: 180, height: 220)
        thumbnail.view.setNeedsLayout(); thumbnail.view.layoutIfNeeded()
        let checks = ["accountHeaderRendersWithoutAmbientStore": account.sizeThatFits(in: CGSize(width: 320, height: 64)).height > 0,
                      "fileTileRendersWithoutAmbientStore": thumbnail.sizeThatFits(in: CGSize(width: 180, height: 220)).height > 0]
        let report: [String: Any] = ["passed": checks.values.allSatisfy { $0 }, "checks": checks,
                                    "scope": "Simulator actual detached UIKit hosting of explicit-owner SwiftUI labels; no physical crash acceptance claim"]
        if let data = try? JSONSerialization.data(withJSONObject: report) { try? data.write(to: URL.applicationSupportDirectory.appending(path: "native-owner-hosting-checks.json"), options: .atomic) }
    }
}
#endif
