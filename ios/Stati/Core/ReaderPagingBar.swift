import SwiftUI

struct ReaderPagingBar: View {
    let index: Int
    let count: Int
    var disabled = false
    let previous: () -> Void
    let next: () -> Void
    var actions: [ReaderAction] = []
    var pageLabels = false
    var showPagePreviews: (() -> Void)?
    var body: some View {
        HStack(spacing: 12) {
            if !actions.isEmpty {
                Menu("Reader options", systemImage: "ellipsis") {
                    ForEach(actions) { action in Button(action.title, systemImage: action.symbol, action: action.perform) }
                }.labelStyle(ActionIconLabelStyle()).frame(minWidth: 44, minHeight: 44).disabled(disabled)
            }
            Button(pageLabels ? "Previous page" : "Previous item", systemImage: "chevron.left", action: previous)
                .disabled(index == 0 || disabled).labelStyle(ActionIconLabelStyle()).frame(minWidth: 44, minHeight: 44)
            if let showPagePreviews {
                Button(action: showPagePreviews) {
                    pageCount.frame(minHeight: 44)
                        .contentShape(.rect)
                }
                .disabled(disabled)
                .onLongPressGesture(perform: showPagePreviews)
                .accessibilityHint("Opens page previews.")
                .hoverEffect(.highlight)
            } else {
                pageCount
            }
            Button(pageLabels ? "Next page" : "Next item", systemImage: "chevron.right", action: next)
                .disabled(index + 1 >= count || disabled).labelStyle(ActionIconLabelStyle()).frame(minWidth: 44, minHeight: 44)
        }.buttonStyle(.plain).fontWeight(.medium).padding(.horizontal, 12).padding(.vertical, 4)
            .glassEffect(.regular, in: .capsule)
            .simultaneousGesture(DragGesture(minimumDistance: 50).onEnded { value in
                guard !disabled, abs(value.translation.width) > abs(value.translation.height) * 1.8 else { return }
                if value.translation.width < -70, index + 1 < count { next() }
                else if value.translation.width > 70, index > 0 { previous() }
            })
            .accessibilityHint(pageLabels ? "Swipe across the control to change pages in this song." : "Swipe across the control to change items.").padding(.horizontal, 16).padding(.bottom, 8)
    }

    private var pageCount: some View {
        Text("\(index + 1) of \(count)")
            .font(.callout)
            .monospacedDigit()
            .frame(minWidth: 70)
            .accessibilityLabel("\(pageLabels ? "Page" : "Item") \(index + 1) of \(count)")
    }
}
