//
//  ShareViewController.swift
//  SortlistShareExtension
//
//  Pure UIKit share extension. No React Native runtime. Reads the JWT
//  from the shared keychain access group `com.alexesterkin.sortlist`
//  (the main app writes it there at sign-in via expo-secure-store) and
//  POSTs the shared URL straight to the backend's products.add tRPC
//  procedure.
//
//  Rendered as a coral-on-cream bottom sheet card. Three states share
//  the same layout so the sheet's height is stable: idle, saving,
//  error/done message.
//

import UIKit
import Security
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {

    // MARK: - Constants

    /// Keychain access group, LITERAL team-prefixed form. Apple's docs claim
    /// iOS auto-prepends the team prefix when you pass the bare form, but
    /// empirically (Build 9 diagnostic: scans C+E both reachable, primary
    /// with bare form gets -34018) iOS does NOT auto-prepend at runtime. So
    /// we have to spell out the team prefix.
    ///
    /// The entitlements XML file uses `$(AppIdentifierPrefix)com.alexesterkin.sortlist`
    /// which Xcode expands at codesign time to this literal string. The
    /// variable is NOT expanded at runtime — only in entitlement files
    /// before signing.
    private static let keychainAccessGroup = "WPX8584UDS.com.alexesterkin.sortlist"
    /// Must exactly match the value expo-secure-store stores under in the
    /// host app. expo-secure-store builds the kSecAttrService value as
    /// `<options.keychainService>:<auth|no-auth>` — we configure
    /// keychainService="sortlist" in lib/session.ts and don't set
    /// requireAuthentication, so the host app writes under
    /// service="sortlist:no-auth". The token key itself
    /// ("sortlist.session_token") ends up in kSecAttrAccount as UTF-8 bytes
    /// (see SecureStoreModule.swift in node_modules/expo-secure-store).
    private static let keychainService = "sortlist:no-auth"
    private static let keychainAccount = "sortlist.session_token"
    private static let apiURL = URL(string: "https://www.sortlist.shop/api/trpc/products.add")!

    private static let coral = UIColor(red: 1.0, green: 0.357, blue: 0.227, alpha: 1.0)
    private static let cream = UIColor(red: 0.980, green: 0.972, blue: 0.953, alpha: 1.0)
    private static let ink = UIColor(red: 0.102, green: 0.102, blue: 0.102, alpha: 1.0)
    private static let inkMuted = UIColor(red: 0.102, green: 0.102, blue: 0.102, alpha: 0.55)
    private static let danger = UIColor(red: 0.831, green: 0.247, blue: 0.149, alpha: 1.0)

    // MARK: - Subviews

    private let dimView = UIView()
    private let cardView = UIView()
    private let grabber = UIView()
    private let brandLabel = UILabel()
    private let titleLabel = UILabel()
    private let urlLabel = UILabel()
    // UITextView (not UILabel) so error / diagnostic text is selectable
    // and copy-pasteable — the share extension is a sandboxed UIKit
    // process with no access to Metro logs or Console.app, so on-screen
    // copy-out is the only way to ship diagnostic data off the device.
    private let statusLabel = UITextView()
    private let cancelButton = UIButton(type: .system)
    private let saveButton = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .medium)

    // MARK: - State

    private var sharedURL: String?
    private var didFinish = false

    // MARK: - Lifecycle

    override func loadView() {
        view = UIView()
        view.backgroundColor = .clear
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        buildLayout()
        extractSharedItem()
    }

    // MARK: - Layout

    private func buildLayout() {
        dimView.backgroundColor = UIColor.black.withAlphaComponent(0.4)
        dimView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(dimView)

        let tap = UITapGestureRecognizer(target: self, action: #selector(onCancel))
        dimView.addGestureRecognizer(tap)

        cardView.backgroundColor = Self.cream
        cardView.layer.cornerRadius = 24
        cardView.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        cardView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(cardView)

        grabber.backgroundColor = UIColor.black.withAlphaComponent(0.12)
        grabber.layer.cornerRadius = 2
        grabber.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(grabber)

        brandLabel.text = "SORTLIST"
        brandLabel.font = UIFont.systemFont(ofSize: 11, weight: .semibold)
        brandLabel.textColor = Self.coral
        brandLabel.numberOfLines = 1
        // 1.0 letter spacing
        brandLabel.attributedText = NSAttributedString(
            string: "SORTLIST",
            attributes: [.kern: 1.5, .font: UIFont.systemFont(ofSize: 11, weight: .semibold), .foregroundColor: Self.coral]
        )
        brandLabel.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(brandLabel)

        titleLabel.text = "Save to Sortlist"
        titleLabel.font = UIFont.systemFont(ofSize: 22, weight: .semibold)
        titleLabel.textColor = Self.ink
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(titleLabel)

        urlLabel.font = UIFont.systemFont(ofSize: 14)
        urlLabel.textColor = Self.inkMuted
        urlLabel.numberOfLines = 2
        urlLabel.text = "Reading shared link…"
        urlLabel.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(urlLabel)

        statusLabel.font = UIFont.systemFont(ofSize: 13)
        statusLabel.textColor = Self.inkMuted
        statusLabel.text = nil
        statusLabel.isEditable = false
        statusLabel.isSelectable = true
        statusLabel.isScrollEnabled = false
        statusLabel.backgroundColor = .clear
        statusLabel.textContainer.lineFragmentPadding = 0
        statusLabel.textContainerInset = .zero
        statusLabel.dataDetectorTypes = []
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(statusLabel)

        styleSecondary(cancelButton, title: "Cancel")
        cancelButton.addTarget(self, action: #selector(onCancel), for: .touchUpInside)
        cancelButton.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(cancelButton)

        stylePrimary(saveButton, title: "Add to Sortlist")
        saveButton.addTarget(self, action: #selector(onSave), for: .touchUpInside)
        saveButton.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(saveButton)

        spinner.color = .white
        spinner.hidesWhenStopped = true
        spinner.translatesAutoresizingMaskIntoConstraints = false
        saveButton.addSubview(spinner)

        NSLayoutConstraint.activate([
            dimView.topAnchor.constraint(equalTo: view.topAnchor),
            dimView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            dimView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            dimView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            cardView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            cardView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            cardView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            grabber.topAnchor.constraint(equalTo: cardView.topAnchor, constant: 10),
            grabber.centerXAnchor.constraint(equalTo: cardView.centerXAnchor),
            grabber.widthAnchor.constraint(equalToConstant: 36),
            grabber.heightAnchor.constraint(equalToConstant: 4),

            brandLabel.topAnchor.constraint(equalTo: grabber.bottomAnchor, constant: 18),
            brandLabel.leadingAnchor.constraint(equalTo: cardView.leadingAnchor, constant: 24),

            titleLabel.topAnchor.constraint(equalTo: brandLabel.bottomAnchor, constant: 6),
            titleLabel.leadingAnchor.constraint(equalTo: cardView.leadingAnchor, constant: 24),
            titleLabel.trailingAnchor.constraint(equalTo: cardView.trailingAnchor, constant: -24),

            urlLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 14),
            urlLabel.leadingAnchor.constraint(equalTo: cardView.leadingAnchor, constant: 24),
            urlLabel.trailingAnchor.constraint(equalTo: cardView.trailingAnchor, constant: -24),

            statusLabel.topAnchor.constraint(equalTo: urlLabel.bottomAnchor, constant: 12),
            statusLabel.leadingAnchor.constraint(equalTo: cardView.leadingAnchor, constant: 24),
            statusLabel.trailingAnchor.constraint(equalTo: cardView.trailingAnchor, constant: -24),

            saveButton.topAnchor.constraint(greaterThanOrEqualTo: statusLabel.bottomAnchor, constant: 18),
            saveButton.heightAnchor.constraint(equalToConstant: 52),
            saveButton.leadingAnchor.constraint(equalTo: cardView.leadingAnchor, constant: 24),
            saveButton.trailingAnchor.constraint(equalTo: cardView.trailingAnchor, constant: -24),

            cancelButton.topAnchor.constraint(equalTo: saveButton.bottomAnchor, constant: 8),
            cancelButton.heightAnchor.constraint(equalToConstant: 44),
            cancelButton.centerXAnchor.constraint(equalTo: cardView.centerXAnchor),
            cancelButton.bottomAnchor.constraint(equalTo: cardView.safeAreaLayoutGuide.bottomAnchor, constant: -16),

            spinner.centerXAnchor.constraint(equalTo: saveButton.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: saveButton.centerYAnchor),
        ])
    }

    private func stylePrimary(_ button: UIButton, title: String) {
        button.setTitle(title, for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .semibold)
        button.backgroundColor = Self.coral
        button.layer.cornerRadius = 14
    }

    private func styleSecondary(_ button: UIButton, title: String) {
        button.setTitle(title, for: .normal)
        button.setTitleColor(Self.ink, for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 15)
    }

    // MARK: - Sharing intake

    private func extractSharedItem() {
        guard let extensionContext = extensionContext else {
            showError("No share context.")
            return
        }

        for item in extensionContext.inputItems {
            guard let extensionItem = item as? NSExtensionItem,
                  let attachments = extensionItem.attachments else { continue }

            for provider in attachments {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] data, _ in
                        DispatchQueue.main.async {
                            guard let self = self else { return }
                            if let url = data as? URL {
                                self.setURL(url.absoluteString)
                            } else if let str = data as? String, let parsed = URL(string: str) {
                                self.setURL(parsed.absoluteString)
                            } else {
                                self.showError("Couldn't read shared URL.")
                            }
                        }
                    }
                    return
                }
                if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] data, _ in
                        DispatchQueue.main.async {
                            guard let self = self else { return }
                            if let text = data as? String,
                               let range = text.range(of: #"https?://\S+"#, options: .regularExpression) {
                                self.setURL(String(text[range]))
                            } else {
                                self.showError("No link found in shared text.")
                            }
                        }
                    }
                    return
                }
            }
        }
        showError("Nothing shareable found.")
    }

    private func setURL(_ url: String) {
        sharedURL = url
        urlLabel.text = url
        urlLabel.textColor = Self.inkMuted
        statusLabel.text = nil
    }

    // MARK: - Actions

    @objc private func onCancel() {
        if didFinish { return }
        didFinish = true
        extensionContext?.cancelRequest(withError: NSError(domain: "user.cancel", code: 0))
    }

    @objc private func onSave() {
        guard !didFinish else { return }
        guard let urlString = sharedURL, !urlString.isEmpty else {
            showError("No URL to save.")
            return
        }
        let token: String
        switch readJWT() {
        case .found(let t):
            token = t
        case .missing(let diagnostic):
            showError("Open Sortlist and sign in first.", diagnostic: diagnostic)
            return
        }

        setSaving(true)
        postToBackend(urlString: urlString, token: token) { [weak self] result in
            DispatchQueue.main.async {
                guard let self = self, !self.didFinish else { return }
                switch result {
                case .success:
                    self.didFinish = true
                    self.dismissExtension()
                case .failure(let message, let diagnostic):
                    self.setSaving(false)
                    self.showError(message, diagnostic: diagnostic)
                }
            }
        }
    }

    private func dismissExtension() {
        extensionContext?.completeRequest(returningItems: [])
    }

    // MARK: - Visual states

    private func setSaving(_ saving: Bool) {
        saveButton.isEnabled = !saving
        saveButton.setTitle(saving ? "" : "Add to Sortlist", for: .normal)
        if saving {
            spinner.startAnimating()
        } else {
            spinner.stopAnimating()
        }
    }

    private func showError(_ message: String, diagnostic: String? = nil) {
        statusLabel.textColor = Self.danger
        guard let diagnostic = diagnostic, !diagnostic.isEmpty else {
            statusLabel.font = UIFont.systemFont(ofSize: 13)
            statusLabel.text = message
            return
        }
        // Compose attributed text: red error headline + monospaced
        // gray-ish diagnostic block. Long-press selects + copies, so the
        // user can paste this back to me verbatim.
        let header = NSMutableAttributedString(
            string: message + "\n\nDiagnostic (long-press to copy):\n",
            attributes: [
                .font: UIFont.systemFont(ofSize: 13),
                .foregroundColor: Self.danger,
            ]
        )
        let body = NSAttributedString(
            string: diagnostic,
            attributes: [
                .font: UIFont.monospacedSystemFont(ofSize: 11, weight: .regular),
                .foregroundColor: Self.ink.withAlphaComponent(0.75),
            ]
        )
        header.append(body)
        statusLabel.attributedText = header
    }

    // MARK: - Auth & networking

    /// Result of attempting to read the JWT from the shared keychain.
    /// On `.missing`, `diagnostic` is a multi-section text block that
    /// describes exactly what we queried for, what came back, and what
    /// else is sitting in the keychain access group. Designed to be
    /// shown verbatim in the share sheet so the user can copy-paste
    /// it back to me without needing Console.app.
    enum JWTReadResult {
        case found(String)
        case missing(diagnostic: String)
    }

    /// Reads the JWT the main app wrote at sign-in via expo-secure-store.
    /// The access group is the one declared in BOTH the main app's
    /// entitlements (app.json) and this extension's entitlements (written
    /// by plugins/with-native-share-extension.js).
    ///
    /// expo-secure-store storage shape:
    ///   - kSecAttrService:     "<keychainService>:<auth|no-auth>"
    ///   - kSecAttrAccount:     Data(<key>.utf8) — JS-side key as raw bytes
    ///   - kSecAttrAccessGroup: bare access group (iOS prepends team prefix)
    private func readJWT() -> JWTReadResult {
        let accountData = Data(Self.keychainAccount.utf8)

        // Primary query — exactly what we expect to find.
        let primary: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: accountData,
            kSecAttrAccessGroup as String: Self.keychainAccessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: AnyObject?
        let primaryStatus = SecItemCopyMatching(primary as CFDictionary, &item)

        if primaryStatus == errSecSuccess,
           let data = item as? Data,
           let token = String(data: data, encoding: .utf8) {
            return .found(token)
        }

        // Anything other than success → assemble the diagnostic.
        var diag = ""
        func line(_ s: String) { diag += s + "\n" }

        line("primary query:")
        line("  OSStatus       = \(primaryStatus) (\(Self.osStatusName(primaryStatus)))")
        line("  service        = \(Self.keychainService)")
        line("  account        = \(Self.keychainAccount)")
        line("  access_group   = \(Self.keychainAccessGroup)")
        line("  ext bundle id  = \(Bundle.main.bundleIdentifier ?? "?")")
        line("")

        // Scan A: same access group + account, any service. Tells us if
        // the JWT is sitting under a DIFFERENT service name (e.g. the
        // legacy "app:no-auth" pre-keychainService-fix would show up here).
        let scanByAccount: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: accountData,
            kSecAttrAccessGroup as String: Self.keychainAccessGroup,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
        ]
        var scanByAccountItems: AnyObject?
        let scanByAccountStatus = SecItemCopyMatching(scanByAccount as CFDictionary, &scanByAccountItems)
        line("scan A (group + account, ANY service):")
        if scanByAccountStatus == errSecSuccess, let array = scanByAccountItems as? [[String: Any]] {
            if array.isEmpty {
                line("  (no matches)")
            } else {
                for attrs in array {
                    let svc = attrs[kSecAttrService as String] as? String ?? "?"
                    line("  service = \(svc)")
                }
            }
        } else if scanByAccountStatus == errSecItemNotFound {
            line("  (no matches — errSecItemNotFound)")
        } else {
            line("  OSStatus = \(scanByAccountStatus) (\(Self.osStatusName(scanByAccountStatus)))")
        }
        line("")

        // Scan B: access group only — tells us if the SE has ANY visibility
        // into the keychain group at all. errSecMissingEntitlement here
        // would be the smoking gun for a wrong entitlement on the SE side.
        let scanByGroup: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccessGroup as String: Self.keychainAccessGroup,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
        ]
        var scanByGroupItems: AnyObject?
        let scanByGroupStatus = SecItemCopyMatching(scanByGroup as CFDictionary, &scanByGroupItems)
        line("scan B (group only, ANY service/account):")
        if scanByGroupStatus == errSecSuccess, let array = scanByGroupItems as? [[String: Any]] {
            if array.isEmpty {
                line("  (group reachable but empty)")
            } else {
                for attrs in array.prefix(20) {
                    let svc = attrs[kSecAttrService as String] as? String ?? "?"
                    let acctStr: String
                    if let d = attrs[kSecAttrAccount as String] as? Data {
                        acctStr = String(data: d, encoding: .utf8) ?? "<bin \(d.count)b>"
                    } else if let s = attrs[kSecAttrAccount as String] as? String {
                        acctStr = s
                    } else {
                        acctStr = "?"
                    }
                    line("  service=\(svc)  account=\(acctStr)")
                }
                if array.count > 20 {
                    line("  …+\(array.count - 20) more")
                }
            }
        } else if scanByGroupStatus == errSecItemNotFound {
            line("  (no items)")
        } else if scanByGroupStatus == errSecMissingEntitlement {
            line("  errSecMissingEntitlement — SE entitlement missing this access_group")
        } else {
            line("  OSStatus = \(scanByGroupStatus) (\(Self.osStatusName(scanByGroupStatus)))")
        }
        line("")

        // Build 9's diagnostic exposed two bugs at once:
        //
        //   1. iOS doesn't auto-prepend the team prefix when given a bare
        //      access group. We now hard-code the prefixed form
        //      "WPX8584UDS.com.alexesterkin.sortlist" in Self.keychainAccessGroup
        //      (see top of file). The bare form `com.alexesterkin.sortlist`
        //      returned -34018 errSecMissingEntitlement even though the binary's
        //      signed entitlement contained the prefixed form.
        //
        //   2. The main app's SecureStore write was throwing -34018 from the
        //      same bug and getting swallowed by writeSecure's catch, so the
        //      JWT only ever made it to AsyncStorage. The Share Extension
        //      can't read AsyncStorage. lib/session.ts now uses the prefixed
        //      form too.
        //
        // Scans D and E below remain as regression checks — they don't depend
        // on Self.keychainAccessGroup's exact form, so they keep working
        // even if the access-group constant changes shape again.

        // Scan D — primary query but with NO kSecAttrAccessGroup key at all.
        // Per Apple docs, omitting this attribute makes iOS use the FIRST
        // group in the process's keychain-access-groups entitlement as the
        // default. If this succeeds while the explicit-group scans all
        // failed, the binary entitlement IS being honored at runtime but
        // our explicit-value lookup isn't matching (encoding mismatch,
        // hidden chars, etc).
        let scanD: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: accountData,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var scanDItem: AnyObject?
        let scanDStatus = SecItemCopyMatching(scanD as CFDictionary, &scanDItem)
        line("scan D (omit kSecAttrAccessGroup — uses default from entitlement):")
        line("  OSStatus = \(scanDStatus) (\(Self.osStatusName(scanDStatus)))")
        if scanDStatus == errSecSuccess {
            line("  (matched — default-group access works; explicit-group lookup is the issue)")
        }
        line("")

        // Scan E — same as scan D, but also omit kSecAttrService. Maximally
        // permissive query. If even THIS returns errSecMissingEntitlement,
        // iOS truly doesn't see this process as having any keychain
        // entitlement — the signed blob isn't being applied at load time.
        let scanE: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var scanEItem: AnyObject?
        let scanEStatus = SecItemCopyMatching(scanE as CFDictionary, &scanEItem)
        line("scan E (no service, no account, no group — maximally permissive):")
        line("  OSStatus = \(scanEStatus) (\(Self.osStatusName(scanEStatus)))")
        if scanEStatus == errSecMissingEntitlement {
            line("  (-34018 even here → signed entitlements aren't being applied to the running process)")
        } else if scanEStatus == errSecItemNotFound {
            line("  (-25300 → process HAS entitlements; signed blob IS applied at runtime)")
        }

        return .missing(diagnostic: diag.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    /// Map common OSStatus values to their symbolic names so the
    /// on-screen diagnostic is readable without needing a Swift REPL.
    private static func osStatusName(_ status: OSStatus) -> String {
        switch status {
        case errSecSuccess: return "errSecSuccess"
        case errSecItemNotFound: return "errSecItemNotFound"
        case errSecMissingEntitlement: return "errSecMissingEntitlement"
        case errSecAuthFailed: return "errSecAuthFailed"
        case errSecInteractionNotAllowed: return "errSecInteractionNotAllowed"
        case errSecParam: return "errSecParam"
        case errSecAllocate: return "errSecAllocate"
        case errSecBadReq: return "errSecBadReq"
        case errSecDuplicateItem: return "errSecDuplicateItem"
        case errSecDecode: return "errSecDecode"
        case errSecUnimplemented: return "errSecUnimplemented"
        case errSecNotAvailable: return "errSecNotAvailable"
        default: return "unknown"
        }
    }

    enum SaveResult {
        case success
        case failure(message: String, diagnostic: String?)
    }

    private func postToBackend(urlString: String, token: String, completion: @escaping (SaveResult) -> Void) {
        var request = URLRequest(url: Self.apiURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Bearer ONLY — never a Cookie header. The backend's
        // authenticateRequest (server/_core/auth.ts:101) does
        // `cookieToken || bearerToken`, so when both are present the
        // cookie wins and a malformed/stale cookie value masks a perfectly
        // valid Bearer (returns ForbiddenError instead of falling back).
        // Empirically: Bearer + Cookie → auth.me null; Bearer alone → success.
        // The main-app tRPC client already enforces this in lib/trpc.ts;
        // mirror it here.
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        // tRPC v11 + superjson wire format. The backend's `products.add`
        // accepts `url` + other optional fields; we only send `url` and
        // let the server-side meta scrape + AI auto-assign do the rest.
        let body: [String: Any] = ["json": ["url": urlString]]
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        } catch {
            completion(.failure(message: "Couldn't encode request.", diagnostic: nil))
            return
        }

        let url = Self.apiURL.absoluteString
        let tokenPreview = "\(token.prefix(12))…(len=\(token.count))"
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                let diag = """
                stage:  URLSession transport error
                url:    \(url)
                token:  \(tokenPreview)
                error:  \(error.localizedDescription)
                """
                completion(.failure(message: error.localizedDescription, diagnostic: diag))
                return
            }
            guard let httpResp = response as? HTTPURLResponse else {
                let diag = """
                stage:  invalid response
                url:    \(url)
                token:  \(tokenPreview)
                """
                completion(.failure(message: "No response from server.", diagnostic: diag))
                return
            }
            if (200...299).contains(httpResp.statusCode) {
                completion(.success)
                return
            }
            // Build a friendly message (parse the tRPC error JSON if we can)
            // AND a full diagnostic with status + raw body so we never lose
            // the server's real complaint.
            var friendly = "HTTP \(httpResp.statusCode)"
            if let data = data,
               let any = try? JSONSerialization.jsonObject(with: data),
               let array = any as? [[String: Any]],
               let first = array.first,
               let err = first["error"] as? [String: Any],
               let json = err["json"] as? [String: Any],
               let message = json["message"] as? String {
                friendly = message
            }
            let bodyString: String
            if let data = data {
                if let s = String(data: data, encoding: .utf8) {
                    bodyString = s.count > 1500 ? String(s.prefix(1500)) + "…" : s
                } else {
                    bodyString = "<binary \(data.count) bytes>"
                }
            } else {
                bodyString = "(empty)"
            }
            let diag = """
            stage:  HTTP non-2xx
            url:    \(url)
            status: \(httpResp.statusCode)
            token:  \(tokenPreview)
            body:
            \(bodyString)
            """
            completion(.failure(message: friendly, diagnostic: diag))
        }
        task.resume()
    }
}
