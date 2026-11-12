import SwiftUI

struct ReaderPagingBar<Previews: View>: View {
    let index: Int
    let count: Int
    var disabled = false
    let previous: () -> Void
    let next: () -> Void
    var actions: [ReaderAction] = []
    var pageLabels = false
    var showPagePreviews: (() -> Void)?
    var guide: WorshipGuide?
    var previewPresented: Binding<Bool>
    @ViewBuilder var previews: () -> Previews
    var body: some View {
        HStack(spacing: 12) {
            if !actions.isEmpty {
                Menu("Reader options", systemImage: "ellipsis") {
                    ForEach(actions) { action in Button(action.title, systemImage: action.symbol, action: action.perform) }
                }.labelStyle(.iconOnly).foregroundStyle(disabled ? .tertiary : .primary).frame(minWidth: 44, minHeight: 44).disabled(disabled)
            }
            arrow(pageLabels ? "Previous page" : "Previous item", symbol: "chevron.left",
                  inactive: index == 0, action: previous)
            if let showPagePreviews {
                Button(action: showPagePreviews) {
                    pageCount.frame(minHeight: 44)
                        .contentShape(.rect)
                }
                .disabled(disabled)
                .onLongPressGesture(perform: showPagePreviews)
                .accessibilityHint("Opens page previews.")
                .hoverEffect(.highlight)
                .worshipGuide(guide, at: .pageCounter)
                .popover(isPresented: previewPresented, arrowEdge: .bottom, content: previews)
            } else {
                pageCount
            }
            arrow(pageLabels ? "Next page" : "Next item", symbol: "chevron.right",
                  inactive: index + 1 >= count, action: next)
        }
            .foregroundStyle(.primary).buttonStyle(.plain).fontWeight(.medium)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .glassEffect(.regular, in: .capsule)
            .simultaneousGesture(DragGesture(minimumDistance: 50).onEnded { value in
                guard !disabled, abs(value.translation.width) > abs(value.translation.height) * 1.8 else { return }
                if value.translation.width < -70, index + 1 < count { next() }
                else if value.translation.width > 70, index > 0 { previous() }
            })
            .accessibilityHint(pageLabels ? "Swipe across the control to change pages in this song." : "Swipe across the control to change items.").padding(.horizontal, 16).padding(.bottom, 8)
    }

    private func arrow(_ title: String, symbol: String, inactive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .accessibilityLabel(title)
        .foregroundStyle(inactive || disabled ? .tertiary : .primary)
        .disabled(inactive || disabled)
    }

    private var pageCount: some View {
        Text("\(index + 1) of \(count)")
            .font(.callout)
            .monospacedDigit()
            .frame(minWidth: 70)
            .accessibilityLabel("\(pageLabels ? "Page" : "Item") \(index + 1) of \(count)")
    }
}
