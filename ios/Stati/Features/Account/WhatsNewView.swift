import SwiftUI

struct WhatsNewView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var details = false
    @State private var history = false
    private let update = AppUpdate.current
    init() {
        #if DEBUG && targetEnvironment(simulator)
        if NativeReview.route == "whats-new-details" { _details = State(initialValue: true) }
        if NativeReview.route == "whats-new-history" { _history = State(initialValue: true) }
        #endif
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("What’s New").font(.title2.bold()).accessibilityAddTraits(.isHeader)
                        Text(update.title).font(.headline)
                        Text("Build \(update.id)").font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    Button("View details", systemImage: "info.circle") { details = true }
                        .labelStyle(ActionIconLabelStyle()).frame(minWidth: 44, minHeight: 44).help("View update details")
                }
                ForEach(update.highlights) { feature in
                    HStack(alignment: .top, spacing: 18) {
                        Image(systemName: feature.icon).font(.system(size: 32, weight: .medium)).foregroundStyle(.tint).frame(width: 44, height: 44).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(feature.title).font(.headline)
                            Text(feature.detail).foregroundStyle(Color.statiSecondary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }.frame(maxWidth: 560, alignment: .leading).frame(maxWidth: .infinity).padding(.horizontal, 28).padding(.top, 40).padding(.bottom, 28)
        }.background(Color(.systemGroupedBackground))
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 12) {
                    Button("Previous updates") { history = true }.font(.subheadline).frame(minHeight: 44)
                    Button { dismiss() } label: { Text("Continue").frame(maxWidth: .infinity) }.buttonStyle(.glassProminent).tint(AppIconAppearance.shared.accent).buttonBorderShape(.capsule).controlSize(.large).frame(maxWidth: .infinity)
                }.frame(maxWidth: 560).frame(maxWidth: .infinity).padding(.horizontal, 28).padding(.bottom, 20).background(Color(.systemGroupedBackground))
            }
            .navigationTitle("").navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(true)
            .toolbar(.hidden, for: .navigationBar, .tabBar)
            .sheet(isPresented: $details) { NavigationStack { UpdateDetailsView(update: update) } }
            .sheet(isPresented: $history) { NavigationStack { UpdateHistoryView() } }
    }
}
