import SwiftUI

/// App actions share the accent; destructive and unavailable actions retain their meaning.
struct ActionIconLabelStyle: LabelStyle {
    @Environment(\.isEnabled) private var isEnabled
    var destructive = false
    func makeBody(configuration: Configuration) -> some View {
        Label(configuration).labelStyle(.iconOnly)
            .foregroundStyle(isEnabled ? (destructive ? Color.red : AppIconAppearance.shared.accent) : Color.secondary)
    }
}
