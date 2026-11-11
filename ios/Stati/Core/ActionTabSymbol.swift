import SwiftUI
import UIKit

/// Native symbol sizing and selection tint; the tab retains its full hit target.
struct ActionTabSymbol: View {
    let name: String
    var weight: UIImage.SymbolWeight = .regular
    var body: some View {
        Image(systemName: name).renderingMode(.template)
            .fontWeight(weight == .semibold ? .semibold : weight == .medium ? .medium : .regular)
            .environment(\.symbolVariants, .none)
    }
}

extension TabRole {
    static var statiSongSearch: Self {
        if #available(iOS 27.0, *) { return .prominent }
        return .search
    }
}
