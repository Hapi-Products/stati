import SwiftUI

struct CommenterHomeView: View {
    @Environment(AppStore.self) private var store
    @State private var model: SongCommentsModel
    init(store: AppStore) { _model = State(initialValue: SongCommentsModel(store: store)) }
    var body: some View {
        List {
            Section { ComputerPicker() }
            if let service = model.service {
                Section {
                    ForEach(service["songs"].records) { song in
                        Button { Task { await model.open(song["songId"].text) } } label: { Label(song.title, systemImage: "music.note").foregroundStyle(.primary).frame(minHeight: 44) }
                    }
                } header: { Text(service.title) } footer: { Text("Current service") }
            } else if !model.loading { Section { Text("No active service. Find a song in Search.").foregroundStyle(Color.statiSecondary) } }
            if !model.items.isEmpty {
                Section("Your comments") {
                    ForEach(model.items) { item in
                        NavigationLink { SongCommentDetailView(commentID: item.id) } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(item.title).font(.headline)
                                Text(item["message"].text).lineLimit(2).foregroundStyle(Color.statiSecondary)
                                Text(item["status"].text == "complete" ? "Reviewed" : item["status"].text == "in-progress" ? "In review" : "Sent").font(.footnote).foregroundStyle(Color.statiSecondary)
                            }.padding(.vertical, 4)
                        }
                    }
                }
            }
            if model.loading { ProgressView("Loading comments…") }
            if !model.message.isEmpty { NoticeView(text: model.message) }
        }.navigationTitle("Comments").navigationBarTitleDisplayMode(.inline)
            .task(id: store.accountEpoch.uuidString + store.selectedComputer) { await model.load()
                #if DEBUG && targetEnvironment(simulator)
                if ["commenter-compose", "commenter-corrections", "commenter-selection"].contains(NativeReview.route ?? "") { await model.open(NativeReview.songID) }
                #endif
            }
            .onChange(of: store.taskChangeRevision) { Task { await model.load() } }
            .onChange(of: store.serviceChangeRevision) { Task { await model.load() } }
            .refreshable { await model.load() }
            .sheet(item: $model.song, onDismiss: { Task { await model.load() } }) { song in SongCorrectionComposer(store: store, computerID: store.selectedComputer, song: song) }
    }
}
