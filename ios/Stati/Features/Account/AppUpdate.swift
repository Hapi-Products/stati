import Foundation

struct AppUpdate: Identifiable {
    struct Highlight: Identifiable {
        let title: String
        let detail: String
        let icon: String
        var id: String { title }
    }
    let id: Int
    let title: String
    let highlights: [Highlight]
    let details: [String]
    static let current = AppUpdate(id: 24, title: "Corrections and Service", highlights: [
        Highlight(title: "Point out each correction", detail: "Select separate passages on iPhone, then tap any selected lyrics to change that correction.", icon: "text.bubble"),
        Highlight(title: "A place for your service", detail: "Open Service on iPad for the running order. Move between its songs from the reader’s Running order menu.", icon: "list.number")
    ], details: ["Full song lyrics scroll with the comment page, without a second scrolling box.", "Each selected passage keeps its own suggested correction.", "Service stays separate from Browse and remembers the song you opened.", "Page controls keep turning pages within the current song.", "Service details remain read-only on iPad."])
    static let previous: [AppUpdate] = [
        AppUpdate(id: 23, title: "Updates on your iPad", highlights: [
        Highlight(title: "See what’s new on iPad", detail: "New app builds show their highlights automatically. You can turn this off in Reading & Features.", icon: "sparkles"),
        Highlight(title: "Worship settings together", detail: "Find your default group, shared groups and team members in Account → Worship.", icon: "person.2")
    ], details: ["App icon previews no longer clip while swiping.", "Song actions follow accessibility text sizing together.", "The iPad update setting does not disable iPhone update pages."]),
        AppUpdate(id: 22, title: "Songs stay together", highlights: [
        Highlight(title: "Keep the final lyrics in view", detail: "Amen stays with the last lyrics, and larger slide text keeps the same lines together.", icon: "music.note.list"),
        Highlight(title: "Connect with your camera", detail: "Scan a computer QR code in Stați, or enter its code below the camera.", icon: "qrcode.viewfinder")
    ], details: ["Computer code controls use native Liquid Glass.", "Slide backgrounds return to dark after viewing a PDF.", "Original lyrics and shared exports remain unchanged."]),
        AppUpdate(id: 21, title: "Invites and your colors", highlights: [
        Highlight(title: "Invite from your phone", detail: "Administrators can show a joining QR code and code, even with the computer closed.", icon: "qrcode"),
        Highlight(title: "Your icon, your color", detail: "Choose from five icons in Account. Stați’s accent follows your applied choice.", icon: "app.badge"),
        Highlight(title: "Clearer song reading", detail: "Song PDFs fill a white screen, with matching song controls on iPhone.", icon: "doc.text")
    ], details: ["Find App icon below Account on iPhone Profile, or in Reading & Features on iPad.", "Scan computer QR codes in the app.", "Administrators can see when their joining code changes.", "Unlink managed shared notes without deleting the group file.", "Fixed an accent-color rendering crash.", "Administrators can open an invite beside a computer in Computers. New members still need approval.", "PDF pages remain fully visible, without dark areas around the paper.", "The iPhone song reader balances Comment, Share and Notes, with a larger Share symbol."]),
        AppUpdate(id: 19, title: "Songs and reading", highlights: [
        Highlight(title: "Songs without the wait", detail: "Browse saved songs right away while offline PDFs save in the background.", icon: "arrow.down.doc"),
        Highlight(title: "More room for the lyrics", detail: "Song actions sit together at the bottom, leaving the title clear above.", icon: "music.note.list"),
        Highlight(title: "Your Stați icon", detail: "Choose from six looks for your Home Screen.", icon: "app.badge")
    ], details: ["Choose Blue, White, Gold, Green, Greyscale or Red in Account → App icon.", "Larger song batches reduce library requests.", "The iPad task panel resizes smoothly, with its actions in the top toolbar.", "The Stați name returns to the iPad sidebar, with your account below.", "iPhone stays in portrait; iPad supports portrait and landscape."]),
        AppUpdate(id: 18, title: "Songs, ready offline", highlights: [], details: ["Loaded songs stay available offline, with PDFs in Files → Stați → Songs.", "Authors appear beside tasks, with names inside their details.", "Saved changes refresh across devices.", "Comment on songs with text, images and selected lyrics.", "Commenters and Pastors cannot use the iPad app for now.", "iPhone stays in portrait."]),
        AppUpdate(id: 15, title: "Songs and groups, simplified", highlights: [], details: ["Named worship groups with selected members.", "Song notes and Share in the top bar.", "Task changes refresh while you work.", "Slides, PDF or text and an alphabetical song browser on iPad."]),
        AppUpdate(id: 14, title: "Songs, page by page", highlights: [], details: ["Songs and linked notes in one reader.", "Glass page controls for songs and file galleries.", "The new blue Stați icon."]),
        AppUpdate(id: 13, title: "A clearer iPad workspace", highlights: [], details: ["One file viewer with Apple Markup.", "Vertical tasks with updated changes.", "Automatic library loading and a default computer setting."]),
        AppUpdate(id: 12, title: "Files and Markup", highlights: [], details: ["Apple Markup for original images and PDFs.", "Recents, Groups, Browse and Tasks on iPad.", "Task images, two per row."]),
        AppUpdate(id: 9, title: "Clearer tasks", highlights: [], details: ["Inline task images.", "Swipe left to delete, right to move.", "Compact details and comments, with image removal separate from opening."]),
        AppUpdate(id: 8, title: "Your song, with your notes", highlights: [], details: ["Link shared group files to songs.", "Open linked notes from a service song.", "Unlinking preserves the shared original."]),
        AppUpdate(id: 7, title: "A simpler iPhone app", highlights: [], details: ["A smaller Profile header.", "Privacy and What’s New inside the app.", "Keep browsing after cancelling search.", "A simpler send list and group file form.", "Clearer selected tab icons."])
    ]
}
