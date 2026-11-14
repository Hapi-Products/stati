import ActivityKit
import SwiftUI
import WidgetKit

@main
struct StatiLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ServiceActivityAttributes.self) { context in
            song(context).padding(16).widgetURL(context.attributes.clickerURL)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) { song(context) }
            } compactLeading: {
                Image(systemName: context.attributes.clickerURL == nil ? "music.note" : "cursorarrow.click")
                    .accessibilityHidden(true)
            } compactTrailing: {
                Text(context.isStale ? "Paused" : context.attributes.clickerURL != nil ? "Clicker" : context.state.song)
                    .font(.caption).lineLimit(1)
            } minimal: {
                Image(systemName: context.attributes.clickerURL != nil ? "cursorarrow.click" : context.isStale ? "pause" : "music.note")
                    .accessibilityLabel(context.attributes.clickerURL != nil ? "Open clicker" : context.isStale ? "Updates paused" : "Live song")
            }
            .widgetURL(context.attributes.clickerURL)
        }
    }

    private func song(_ context: ActivityViewContext<ServiceActivityAttributes>) -> some View {
        HStack(spacing: 12) {
            Image(systemName: context.attributes.clickerURL != nil ? "cursorarrow.click" : context.isStale ? "pause.circle" : "music.note")
                .font(.title3).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(context.attributes.service).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Text(context.state.song).font(.headline).lineLimit(2)
                if context.isStale {
                    Text("Updates paused").font(.caption).foregroundStyle(.secondary)
                } else if context.attributes.clickerURL != nil {
                    Text("Open clicker").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}
