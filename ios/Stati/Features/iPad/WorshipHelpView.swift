import SwiftUI

enum WorshipHelpTopic {
    case settings, reader

    struct Step {
        let title: String
        let instruction: String
    }

    var title: String {
        switch self {
        case .settings: "Worship settings"
        case .reader: "Song reader"
        }
    }

    var wikiURL: URL {
        let page = self == .settings ? "Worship-Settings" : "Song-Reader"
        return URL(string: "https://github.com/Hapi-Products/stati/wiki/" + page)!
    }

    var steps: [Step] {
        switch self {
        case .settings:
            [
                Step(title: "Find your settings", instruction: "In Stați, open Account → Features. You can also change these preferences in Settings → Apps → Stați → Features on this iPad."),
                Step(title: "Choose a reading format", instruction: "Choose Slides, PDF document, or Text. Use the slide text size slider, or open PDF options to change columns and the page effect."),
                Step(title: "Set the song selector", instruction: "Choose Recents or Current service. The selector shows Recents when there is no active service."),
                Step(title: "Choose a group or computer", instruction: "Use Account → Worship for a named group or song folder. Choose your default computer in Account.")
            ]
        case .reader:
            [
                Step(title: "Open a song", instruction: "Choose a song from Songs or from the running order under Service."),
                Step(title: "Move through the slides", instruction: "Tap the left or right side of the reader to move one slide. Touch and hold the page counter to see previews and jump to a slide."),
                Step(title: "Choose the next song", instruction: "Tap the song selector icon. The list follows Recents or the current service, depending on your Worship settings.")
            ]
        }
    }
}

struct WorshipHelpView: View {
    let topic: WorshipHelpTopic
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        WorshipHelpSteps(topic: topic)
                    } label: {
                        Label("Step-by-step guide", systemImage: "list.number")
                    }
                }
                Section {
                    ForEach(topic.steps, id: \.title) { step in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(step.title).font(.headline).accessibilityAddTraits(.isHeader)
                            Text(step.instruction).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
                Section {
                    Link(destination: topic.wikiURL) {
                        Label("Read the full wiki guide", systemImage: "arrow.up.right")
                    }
                }
            }
            .navigationTitle(topic.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close help", systemImage: "xmark") { dismiss() }.labelStyle(.iconOnly)
                }
            }
        }
        .presentationSizing(.form)
    }
}

private struct WorshipHelpSteps: View {
    let topic: WorshipHelpTopic
    @Environment(\.dismiss) private var dismiss
    @State private var index = 0

    var body: some View {
        ScrollView {
            let step = topic.steps[index]
            VStack(alignment: .leading, spacing: 12) {
                Text("Step \(index + 1) of \(topic.steps.count)").font(.subheadline).foregroundStyle(.secondary)
                Text(step.title).font(.title2.bold()).accessibilityAddTraits(.isHeader)
                Text(step.instruction).font(.body)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
        .navigationTitle(topic.title)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            HStack {
                Button("Previous step", systemImage: "chevron.left") { index -= 1 }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.glass)
                    .disabled(index == 0)
                Spacer()
                if index + 1 < topic.steps.count {
                    Button("Next step", systemImage: "chevron.right") { index += 1 }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glassProminent)
                } else {
                    Button("Finish", systemImage: "checkmark") { dismiss() }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glassProminent)
                }
            }
            .controlSize(.large)
            .padding(20)
        }
    }
}
