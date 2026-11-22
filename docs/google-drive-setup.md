# Google Drive setup for Stați

The iPad chooses an individual Drive item using Google Picker and sends its authorization code with proof of possession to the Stați server. Stați checks the selected file’s metadata against the approved folder ID before downloading it. For each presentation computer, Stați stores the folder ID and name, members’ account limits, and a Google account label and hashed identifier for each linked account. Each member can see their own Google account labels. iPhone administrators see members’ limits and linked account counts. Google access and refresh tokens are never stored.

## Configure a Google Cloud test project

1. Enable **Google Drive API** and **Google Picker API**.
2. In Google Auth Platform, configure the app’s actual branding, home page, privacy policy and test users. Request only `https://www.googleapis.com/auth/drive.file`.
3. Create a web application OAuth client for the HTTPS Stați callback. For production, register the exact redirect URI `https://stati.ciani01.org/api/google-drive/callback`. For testing, use an HTTPS test deployment and a development build pointing at that deployment.
4. Set the public `GOOGLE_DRIVE_CLIENT_ID` as a Worker variable and `GOOGLE_DRIVE_CLIENT_SECRET` as an encrypted Worker secret. Keep the client secret out of Wrangler configuration and Git. Apply the D1 migrations through `0041_file_provider_accounts.sql` before deploying the code to the same environment. Use the release guard for production.
5. In Stați on iPhone, sign in as an administrator and open **Profile → Features → File Providers**. Choose a computer and approve a shared folder named **stati-music**, **stati-folder**, or **stati**. Under **Member Access**, give a test member one account slot. Check that the member can add an account from Features on iPad or iPhone. On iPad, select a synthetic song from the folder and send it to the test computer for review. Check cancellation, a second Google account, a file outside the approved folder, and revocation.
6. Review the OAuth branding and privacy disclosures for the actual deployment before submitting the app to Google for production verification. Use Verification Center to check the result.

Beginning with build 81, the user can search the signed-in Google Drive in Google Picker to find a folder. Account linking still requires selecting the exact approved folder. The Google account must already be able to open it. Test OAuth and Picker behavior with a signed-in account in the configured Google project.

[Google Picker for desktop and mobile apps](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker)
[Google OAuth branding verification](https://developers.google.com/identity/verification/authentication-verification)
