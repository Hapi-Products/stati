import SwiftUI

struct NoticeView: View {
    let text: String
    var body: some View {
        if !text.isEmpty { Label(text, systemImage: "info.circle").font(.callout).foregroundStyle(Color.statiSecondary).accessibilityElement(children: .combine) }
    }
}
