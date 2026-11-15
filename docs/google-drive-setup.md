# Google Drive setup for Stați

The iPad chooses an individual Drive item using Google Picker and sends its authorization code with proof of possession to the Stați server. Stați uses the selected file’s metadata to check the approved folder ID and downloads only that file. Stați keeps the folder ID, folder name and member upload setting per presentation computer. It does not store Google access or refresh tokens. The iPad then uses the normal file delivery and service request flow.

## Configure a Google Cloud test project

1. Enable **Google Drive API** and **Google Picker API**.
2. In Google Auth Platform, configure the app’s actual branding, home page, privacy policy and test users. Request only `https://www.googleapis.com/auth/drive.file`.
3. Create a web application OAuth client for the HTTPS Stați callback. For production, register the exact redirect URI `https://stati.ciani01.org/api/google-drive/callback`. For testing, use an HTTPS test deployment and a development build pointing at that deployment.
4. Set `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET` as Worker secrets. Never commit credential values. Apply `0040_station_drive_folders.sql` before deploying the code to the same environment. Use the release guard for production.
5. With a Drive test account, select a shared **Statsi Music** folder as a Stați administrator. Verify that an approved worship member can select a synthetic song in the folder only after member uploads are enabled. Send it to a test computer, submit the request, and confirm the computer can review it. Check cancellation, a file outside the approved folder, and revocation.
6. Review the OAuth branding and privacy disclosures for the actual deployment before submitting the app to Google for production verification. Use Verification Center to check the result.

Google OAuth and Picker behavior in a signed-in browser must be tested with the configured project. The mocked API tests only exercise the Stați side of the integration.

[Google Picker for desktop and mobile apps](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker)
[Google OAuth branding verification](https://developers.google.com/identity/verification/authentication-verification)
