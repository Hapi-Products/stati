import SwiftUI

struct AppIconPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        NavigationStack {
            AppIconPickerView().toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close app icons", systemImage: "xmark") { dismiss() }.labelStyle(ActionIconLabelStyle())
                }
            }
        }.presentationDetents(typeSize.isAccessibilitySize ? [.large] : [.height(UIDevice.current.userInterfaceIdiom == .phone ? 330 : 360)])
            .presentationDragIndicator(.visible).presentationSizing(.form)
    }
}
