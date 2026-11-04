import SwiftUI

/// Standard Section with a readable semantic heading in both appearances.
struct LabeledSection<Content: View>: View {
    let title: LocalizedStringKey
    let content: Content
    init(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) { self.title = title; self.content = content() }
    var body: some View { Section { content } header: { SectionHeading(title) } }
}
