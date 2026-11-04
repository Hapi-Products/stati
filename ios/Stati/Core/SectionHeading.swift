import SwiftUI

struct SectionHeading: View {
    let title: LocalizedStringKey
    init(_ title: LocalizedStringKey) { self.title = title }
    var body: some View { Text(title).foregroundStyle(Color.statiSecondary) }
}
