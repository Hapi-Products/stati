import Foundation

enum DraftTestFailure: Error { case failed(String) }

@main struct WorkspaceModelTests {
    @MainActor static func main() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("stati-native-drafts-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let helper = directory.appendingPathComponent("Engine.app")
        let executable = helper.appendingPathComponent("Contents/MacOS/TestEngine")
        try FileManager.default.createDirectory(at: executable.deletingLastPathComponent(), withIntermediateDirectories: true)
        try """
        <?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.hapiproducts.stati.draft-test</string><key>CFBundleExecutable</key><string>TestEngine</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>
        """.write(to: helper.appendingPathComponent("Contents/Info.plist"), atomically: true, encoding: .utf8)
        try """
        #!/usr/bin/env python3
        import sys, json, time
        requests, pending, persisted = [], [], None
        profile_id = 'b9ee8c5a-ae5b-45ac-a301-3e70f17205b9'
        profiles = [
            {'id':profile_id,'first_name':'Mara','last_initial':'T','role':'admin','has_photo':1},
            {'id':'44c48b1d-c50b-45fa-adba-cc5b012fd0dd'},
            {'id':'5b04887d-c214-44b9-87a4-00c01780701b','first_name':'Hidden','ministryRole':'pastor'}
        ]
        approved, opened, unlock_checks, cancels, pin_checks = False, False, 0, 0, 0
        storage_available = False
        def reply(request, value):
            print('STATI_NATIVE:' + json.dumps({'id':request['id'],'result':value}), flush=True)
        for line in sys.stdin:
            request = json.loads(line)
            method = request['method']
            if method == 'prepare-draft-save':
                requests.append(request['args'][0])
                pending.append(request)
            elif method == 'test-stats':
                reply(request, {'requests':requests,'persisted':persisted,'pending':len(pending),
                                'unlockChecks':unlock_checks,'opened':opened,'cancels':cancels,'pinChecks':pin_checks})
            elif method == 'test-release':
                if pending:
                    saved = pending.pop(0)
                    persisted = saved['args'][0]
                    reply(saved, {'savedAt':1})
                reply(request, True)
            elif method == 'access-status':
                reply(request, {'allowed':True} if storage_available else {'allowed':False,'protectedStorage':'loading'})
            elif method == 'test-unlock-storage':
                storage_available = True
                reply(request, True)
            elif method == 'native-status':
                reply(request, {'operatorId':profile_id if opened else None, 'locked':False, 'paired':False})
            elif method == 'operator':
                pin_checks += 1
                assert request['args'][0]['id'] == profile_id
                approved, opened = request['args'][0].get('pin') == '4821', False
                if approved:
                    reply(request, {'ok':True})
                else:
                    print('STATI_NATIVE:' + json.dumps({'id':request['id'],'error':{'message':'Incorrect PIN.'}}), flush=True)
            elif method == 'state':
                reply(request, {'paired':True,'members':profiles})
            elif method == 'operator-unlock':
                assert request['args'] == [profile_id]
                approved, opened = False, False
                reply(request, {'token':'phone-test-token','qr':'fixture','expiresAt':time.time()+120})
            elif method == 'operator-unlock-status':
                assert request['args'] == ['phone-test-token']
                unlock_checks += 1
                reply(request, {'approved':approved})
            elif method == 'test-reset':
                approved, opened = False, False
                reply(request, True)
            elif method == 'test-approve':
                approved = True
                reply(request, True)
            elif method == 'workspace-open':
                assert approved
                opened = True
                reply(request, True)
            elif method == 'operator-unlock-cancel':
                cancels += 1
                approved, opened = False, False
                reply(request, True)
            elif method == 'prepare-draft-load':
                assert opened
                reply(request, {'draft':{'title':'Saved title','text':'Saved lyrics','lines':4}})
            elif method == 'prepare-slides':
                assert opened
                reply(request, [{'text':request['args'][0]['text']}])
        """.write(to: executable, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
        let engine = EngineClient(helperURL: helper)
        let model = WorkspaceModel(engine: engine)
        model.status = .object(["operatorId": .string("operator-one")])
        model.draftOwner = "operator-one"; model.draftLoaded = true
        model.title = "Original title"; model.lyrics = "Original lyrics"; model.lines = 4; model.draftDirty = true
        let first = Task { await model.saveDraft() }
        try await wait(engine, count: 1)
        model.title = "Edited title"; model.lyrics = "Edited lyrics"; model.lines = 6; model.draftDirty = true
        let concurrent = Task { await model.saveDraft() }
        _ = try await engine.call("test-release")
        try await wait(engine, count: 2)
        let inFlight = try await engine.call("test-stats")
        guard model.draftDirty else { throw DraftTestFailure.failed("Old response marked later edits clean") }
        guard inFlight["requests"].array[1]["text"].string == "Edited lyrics", inFlight["requests"].array[1]["title"].string == "Edited title", inFlight["requests"].array[1]["lines"].number == 6 else { throw DraftTestFailure.failed("Latest edits were not queued") }
        guard inFlight["persisted"]["text"].string == "Original lyrics" else { throw DraftTestFailure.failed("Gate did not retain original save") }
        _ = try await engine.call("test-release")
        await first.value; await concurrent.value
        let finished = try await engine.call("test-stats")
        guard !model.draftDirty, finished["persisted"]["text"].string == "Edited lyrics" else { throw DraftTestFailure.failed("Latest draft did not finish cleanly") }
        // A different operation must not silently drop a draft save.
        model.working = true; model.lyrics = "Edited during export"; model.draftDirty = true
        let whileBusy = Task { await model.saveDraft() }
        try await wait(engine, count: 3)
        _ = try await engine.call("test-release"); await whileBusy.value
        guard !model.draftDirty else { throw DraftTestFailure.failed("Busy operation dropped draft save") }
        // An old owner's response must never mark a replacement owner's draft clean.
        model.working = false; model.lyrics = "Old owner pending"; model.draftDirty = true
        let oldOwner = Task { await model.saveDraft() }
        try await wait(engine, count: 4)
        model.invalidatePrivateState()
        model.status = .object(["operatorId": .string("operator-two")]); model.draftOwner = "operator-two"; model.draftLoaded = true
        model.lyrics = "Second owner's unsaved text"; model.draftDirty = true
        _ = try await engine.call("test-release"); await oldOwner.value
        guard model.draftDirty, model.lyrics == "Second owner's unsaved text" else { throw DraftTestFailure.failed("Old owner response changed replacement draft") }
        try await checkStartupRetry(engine)
        try await checkProfileApproval(engine)
        try checkDiagnosticReport()
        await engine.stop()
        print("Native draft regression: 4 checks passed (in-flight edits stay dirty; latest snapshot saved; other operations do not drop saves; old identity responses cannot mark a new draft clean).")
    }
    @MainActor static func checkStartupRetry(_ engine: EngineClient) async throws {
        let model = WorkspaceModel(engine: engine)
        await model.boot()
        guard !model.connected, !model.connecting, model.error.contains("protected pairing") else {
            throw DraftTestFailure.failed("Pending Keychain access should leave startup recoverable")
        }
        _ = try await engine.call("test-unlock-storage")
        await model.retryConnection()
        guard model.connected, model.error.isEmpty, model.profileOptions.first?.name == "Mara T." else {
            throw DraftTestFailure.failed("Retry should finish startup and load the named roster")
        }
        print("Native startup regression passed (pending Keychain, explicit Retry, roster refresh).")
    }
    @MainActor static func checkProfileApproval(_ engine: EngineClient) async throws {
        let model = WorkspaceModel(engine: engine)
        model.connected = true
        model.showProfile = true
        model.destination = .prepare
        await model.refresh()
        guard model.profileOptions.count == 1, let profile = model.profileOptions.first,
              profile.name == "Mara T.", profile.isAdministrator, profile.hasPhoto, profile.initials == "MT" else {
            throw DraftTestFailure.failed("Station roster names or eligibility were decoded incorrectly")
        }

        await model.chooseProfile(profile)
        await model.requestPhoneSignIn()
        guard model.showProfile, !model.unlocked, model.unlock != .null else {
            throw DraftTestFailure.failed("Starting phone approval unlocked the workspace")
        }
        var checks = try await engine.call("test-stats")
        for _ in 0..<80 where checks["unlockChecks"].number == 0 {
            try await Task.sleep(for: .milliseconds(10))
            checks = try await engine.call("test-stats")
        }
        guard checks["unlockChecks"].number > 0, !checks["opened"].bool else {
            throw DraftTestFailure.failed("Phone approval was not polled or opened the workspace early")
        }

        _ = try await engine.call("test-approve")
        for _ in 0..<360 where !model.draftLoaded {
            try await Task.sleep(for: .milliseconds(10))
        }
        guard model.unlocked, !model.showProfile, model.operatorName == "Mara T.",
              model.draftLoaded, model.lyrics == "Saved lyrics" else {
            throw DraftTestFailure.failed("Phone approval did not open the workspace and restore Prepare slides")
        }
        await model.previewSlides()
        guard model.slides.first?["text"].string == "Saved lyrics" else {
            throw DraftTestFailure.failed("Approved profile could not prepare slides")
        }

        let retryModel = WorkspaceModel(engine: engine)
        retryModel.connected = true
        await retryModel.refresh()
        // Simulate a fresh signed-out state before exercising both methods.
        _ = try await engine.call("test-reset")
        await retryModel.refresh()
        await retryModel.chooseProfile(profile)
        await retryModel.endPendingProfile()
        guard retryModel.paired, retryModel.pendingProfile == nil, !retryModel.unlocked else {
            throw DraftTestFailure.failed("Cancel from PIN entry must return to the paired roster")
        }
        await retryModel.chooseProfile(profile)
        await retryModel.submitPIN("9999")
        guard !retryModel.unlocked, retryModel.pendingProfile?.id == profile.id,
              retryModel.profileError == "Incorrect PIN." else {
            throw DraftTestFailure.failed("Rejected PIN should leave the selected profile available to retry")
        }
        await retryModel.endPendingProfile()
        await retryModel.chooseProfile(profile)
        await retryModel.requestPhoneSignIn()
        await retryModel.endPendingProfile()
        let canceled = try await engine.call("test-stats")
        guard retryModel.unlock == .null, retryModel.paired, !retryModel.unlocked,
              retryModel.pendingProfile == nil, !canceled["opened"].bool, canceled["cancels"].number == 1 else {
            throw DraftTestFailure.failed("Dismissing the profile sheet did not cancel the pending request")
        }
        await retryModel.chooseProfile(profile)
        await retryModel.submitPIN("4821")
        let signedIn = try await engine.call("test-stats")
        guard retryModel.unlocked, retryModel.operatorName == "Mara T.", retryModel.pendingProfile == nil,
              signedIn["pinChecks"].number == 2 else {
            throw DraftTestFailure.failed("The Windows-compatible PIN flow did not open the selected profile")
        }
        print("Native profile regression passed (avatar metadata, PIN rejection and approval, phone approval, Prepare slides, and paired roster cancellation).")
    }
    static func checkDiagnosticReport() throws {
        let report = DiagnosticReport(.object([
            "connection": .string("timeout"),
            "latencyMs": .number(1_250),
            "protectedStorage": .bool(true),
            "explanation": .string("private response details"),
            "token": .string("private credential"),
            "organization": .string("private organization")
        ]), appVersion: "0.1.0", build: "123")
        guard let url = report.issueURL, let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.host == "github.com", components.path == "/Hapi-Products/stati/issues/new",
              let body = components.queryItems?.first(where: { $0.name == "body" })?.value,
              body.contains("Timed out"), body.contains("1250 ms"), !body.contains("private") else {
            throw DraftTestFailure.failed("Developer diagnostics must include only approved operational fields")
        }
        print("Native diagnostics regression passed (reviewable public issue draft with allowlisted fields).")
    }

    static func wait(_ engine: EngineClient, count: Int) async throws {
        for _ in 0..<60 {
            let stats = try await engine.call("test-stats")
            if stats["requests"].array.count >= count { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        throw DraftTestFailure.failed("Draft save \(count) never reached the helper")
    }
}
