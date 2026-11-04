import SwiftUI

struct PrivacyView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Stați is managed by Hapi Products.")
                section("Accounts", "We store your first name, last initial, optional photo, approval status, and passkey public credentials. Your private passkey stays on your device.")
                section("Files", "Cloudflare temporarily stores files for delivery. Files are removed after delivery acknowledgement or by hourly cleanup after their 24-hour expiry. Downloads and email drafts on the computer remain until the operator manages them. Delivery status, filenames and rejection reasons remain online for seven days; the computer keeps its own delivery record.")
                section("Songs and services", "The paired computer shares a catalog containing song titles, lyrics and first-slide text. Approved worship roles, choir directors, pastors and administrators can browse the catalog. Authorized worship roles and administrators can plan services. These shared records stay in Stați until managed or the service is retired; removing a computer revokes access. Original presentation files stay on the PC.")
                section("Shared group files", "Chord sheets and lyric images shared with the ministry team remain available until their uploader or an administrator removes the shared copy. Group names help organize these files; approved ministry roles can read all shared group files.")
                section("Feedback and tasks", "Tasks and notes are shared with approved team members. Your name is shown with submissions and replies. These records remain until managed by the church team.")
                section("PC tools", "Conversion and OCR happen only in the Windows companion. No AI provider receives your files. Automatic clock contrast samples the screen locally without saving or uploading it.")
                section("Access", "Church administrators manage membership and computers. Essential cookies remember passcode access and sign-in. The computer displays a changing code for new account setup. Existing passkey members can sign in while the computer is offline.")
                Text("Ask your administrator for corrections or account removal. Final retention and Windows compatibility checks are still in progress.")
            }.font(.body).textSelection(.enabled).padding(24).frame(maxWidth: 640, alignment: .leading).frame(maxWidth: .infinity)
        }.navigationTitle("Privacy").navigationBarTitleDisplayMode(.inline)
    }
    private func section(_ title: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline).accessibilityAddTraits(.isHeader)
            Text(body).foregroundStyle(Color.statiSecondary)
        }
    }
}
