import SwiftUI
struct InspectorResizeHandle: View {
    @Binding var width: CGFloat
    @State private var startingWidth: CGFloat?
    @GestureState private var dragging = false
    var maximumWidth: CGFloat = 640
    var body: some View {
        Capsule().fill(Color(.tertiaryLabel)).frame(width: 4, height: 44)
            .frame(width: 44).frame(maxHeight: .infinity).contentShape(.rect)
            .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .global).updating($dragging) { _, active, _ in active = true }.onChanged { value in
                if startingWidth == nil { startingWidth = width }
                width = min(maximumWidth, max(320, (startingWidth ?? width) - value.translation.width))
            }.onEnded { _ in startingWidth = nil })
            .onChange(of: dragging) { _, active in if !active { startingWidth = nil } }
            .onChange(of: maximumWidth) { startingWidth = nil }
            .accessibilityElement().accessibilityLabel("Resize task details")
            .accessibilityValue("\(Int(width)) points wide")
            .accessibilityHint("Drag left for more detail space.")
            .accessibilityAdjustableAction { direction in width = min(maximumWidth, max(320, width + (direction == .increment ? 40 : -40))) }
    }
}
