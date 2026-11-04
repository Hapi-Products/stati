import SwiftUI

struct AppIconPickerView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var current = UIApplication.shared.alternateIconName
    @State private var preview: String? = UIApplication.shared.alternateIconName.map { String($0.dropFirst(7)) } ?? "Blue"
    @State private var changing = false
    @State private var message = ""
    private let names = ["Blue", "Gold", "Green", "Greyscale", "Red"]
    private var chosen: String { if let preview, names.contains(preview) { preview } else { "Blue" } }
    private var isCurrent: Bool { current == iconName(chosen) }
    var body: some View {
        ScrollView {
            if UIApplication.shared.supportsAlternateIcons {
                VStack(spacing: 8) {
                    carousel.frame(height: 148)
                        .accessibilityElement(children: .ignore).accessibilityLabel("App icon")
                        .accessibilityValue(chosen).accessibilityAdjustableAction { direction in
                            let index = names.firstIndex(of: chosen) ?? 0
                            switch direction {
                            case .increment: select(names[min(names.count - 1, index + 1)])
                            case .decrement: select(names[max(0, index - 1)])
                            @unknown default: break
                            }
                        }
                    Text(chosen).font(.title3.bold()).id(chosen).transition(.blurReplace)
                        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: chosen)
                        .accessibilityLabel(chosen + " icon preview")
                }.padding(.vertical, 8).frame(maxWidth: 600).frame(maxWidth: .infinity)
            } else { ContentUnavailableView("App icons unavailable", systemImage: "app", description: Text("This device cannot change the app icon right now.")) }
        }.background(.background).navigationTitle("App icon").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .principal) {
                Text("\((names.firstIndex(of: chosen) ?? 0) + 1) / \(names.count)").font(.subheadline.monospacedDigit()).foregroundStyle(.tint)
                    .contentTransition(.numericText()).accessibilityLabel("Icon \((names.firstIndex(of: chosen) ?? 0) + 1) of \(names.count)")
            } }
            .safeAreaInset(edge: .bottom) {
                if UIApplication.shared.supportsAlternateIcons {
                    Group {
                        if isCurrent && !changing {
                            Label("Current icon", systemImage: "checkmark.circle.fill")
                                .font(.subheadline).foregroundStyle(Color.statiSecondary).frame(minHeight: 44)
                        } else {
                            Button { Task { await apply() } } label: {
                                HStack {
                                    if changing { ProgressView().tint(.white) }
                                    Text(changing ? "Applying…" : "Use " + chosen).frame(maxWidth: .infinity)
                                }.padding(.vertical, 4)
                            }.buttonStyle(.glassProminent).tint(AppIconAppearance.shared.fill).foregroundStyle(.white)
                                .buttonBorderShape(.capsule).controlSize(.large).disabled(changing)
                        }
                    }.frame(maxWidth: 540).frame(maxWidth: .infinity).padding(.horizontal, 16).padding(.top, 28).padding(.bottom, 4)
                }
            }
            .onChange(of: scenePhase) { _, phase in if phase == .active { current = UIApplication.shared.alternateIconName; AppIconAppearance.shared.synchronize() } }
            .task {
                #if DEBUG && targetEnvironment(simulator)
                if NativeReview.route == "app-icons-gold" { select("Gold") }
                if NativeReview.route == "app-icons-motion" {
                    for name in names.dropFirst() {
                        do { try await Task.sleep(for: .seconds(1)) } catch { return }
                        select(name) // Preview-only review: never calls the system icon-changing API.
                    }
                }
                #endif
            }
            .alert("Could not change icon", isPresented: Binding(get: { !message.isEmpty }, set: { if !$0 { message = "" } })) { Button("OK", role: .cancel) { message = "" } } message: { Text(message) }
    }
    private var carousel: some View {
        let reduced = reduceMotion
        return GeometryReader { geometry in
            let side: CGFloat = 148
            ScrollView(.horizontal) {
                HStack(spacing: 0) {
                    ForEach(names, id: \.self) { name in
                        Image("Icon" + name + "Preview").resizable().scaledToFit().frame(width: side, height: side)
                            .clipShape(.rect(cornerRadius: 33))
                            // Adapted from Kavsoft's supplied tutorial at 7:28: scroll-position scale, blur, offset and rotation.
                            .visualEffect { content, proxy in
                                let distance = proxy.frame(in: .scrollView(axis: .horizontal)).minX
                                let amount = min(abs(distance / side), 1)
                                return content
                                    .scaleEffect(reduced ? 1 : 1 - amount * 0.3)
                                    .blur(radius: reduced ? 0 : amount * 4)
                                    .offset(x: reduced ? 0 : distance / 2)
                                    .rotationEffect(.degrees(reduced ? 0 : -amount * side / 2))
                            }.id(name).accessibilityLabel(name + " icon")
                    }
                }.scrollTargetLayout()
            }.scrollClipDisabled().scrollIndicators(.hidden).scrollTargetBehavior(.viewAligned(limitBehavior: .alwaysByOne))
                .scrollPosition(id: $preview, anchor: .center)
                .safeAreaPadding(.horizontal, max(0, (geometry.size.width - side) / 2))
                .scrollDisabled(changing)
        }
    }
    private func select(_ name: String) {
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.35)) { preview = name }
    }
    private func iconName(_ name: String) -> String? { name == "Blue" ? nil : "AppIcon" + name }
    private func apply() async {
        guard !changing, UIApplication.shared.supportsAlternateIcons, !isCurrent else { return }
        let requested = iconName(chosen)
        changing = true; defer { changing = false }
        do { try await UIApplication.shared.setAlternateIconName(requested); current = UIApplication.shared.alternateIconName; AppIconAppearance.shared.synchronize() }
        catch { current = UIApplication.shared.alternateIconName; message = error.localizedDescription }
    }
}
