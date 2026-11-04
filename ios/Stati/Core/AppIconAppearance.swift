import SwiftUI
import Observation

@MainActor @Observable final class AppIconAppearance {
    static let shared = AppIconAppearance()
    private(set) var name = "Blue"
    private init() { synchronize() }
    func synchronize() {
        let applied = UIApplication.shared.alternateIconName?.replacingOccurrences(of: "AppIcon", with: "") ?? "Blue"
        name = ["Gold", "Green", "Greyscale", "Red"].contains(applied) ? applied : "Blue"
        UINavigationBar.appearance().tintColor = UIColor(accent)
        UIBarButtonItem.appearance().tintColor = UIColor(accent)
    }
    var accent: Color { Color(uiColor: Self.adaptiveColor(name)) }
    // UIKit resolves dynamic colors on background rendering queues too.
    nonisolated static func adaptiveColor(_ selected: String) -> UIColor {
        UIColor { traits in
            let dark = traits.userInterfaceStyle == .dark
            switch selected {
            case "Gold": return dark ? UIColor(red:1,green:0.77,blue:0.28,alpha:1) : UIColor(red:0.48,green:0.32,blue:0,alpha:1)
            case "Green": return dark ? UIColor(red:0.24,green:0.85,blue:0.58,alpha:1) : UIColor(red:0,green:0.40,blue:0.25,alpha:1)
            case "Red": return dark ? UIColor(red:1,green:0.46,blue:0.54,alpha:1) : UIColor(red:0.75,green:0.10,blue:0.24,alpha:1)
            case "Greyscale": return dark ? .lightGray : .darkGray
            default: return UIColor(named:"AccentColor") ?? .systemBlue
            }
        }
    }
    var fill: Color {
        switch name {
        case "Gold": Color(red:0.48,green:0.32,blue:0)
        case "Green": Color(red:0,green:0.40,blue:0.25)
        case "Red": Color(red:0.75,green:0.10,blue:0.24)
        case "Greyscale": Color(white:0.30)
        default: Color("ActionFill")
        }
    }
}
