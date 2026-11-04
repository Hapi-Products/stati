import SwiftUI

struct ProfileDestinationRow: View {
    let title: String
    let icon: String
    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon).font(.title2).foregroundStyle(AppIconAppearance.shared.accent).frame(width: 40, height: 44).accessibilityHidden(true)
            Text(title).font(.body.weight(.medium))
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.statiSecondary).accessibilityHidden(true)
        }.foregroundStyle(Color.primary).frame(minHeight: 66).contentShape(.rect)
    }
}
