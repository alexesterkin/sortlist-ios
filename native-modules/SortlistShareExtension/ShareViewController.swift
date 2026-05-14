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

    /// Keychain access group must match `ios.entitlements.keychain-access-groups`
    /// in the host app's app.json AND the SortlistShareExtension.entitlements
    /// file that the config plugin writes. The bare value (no `$(AppIdentifierPrefix)`
    /// prefix) is what SecItemCopyMatching wants — iOS prepends the team prefix.
    private static let keychainAccessGroup = "com.alexesterkin.sortlist"
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
    private static let cookieName = "app_session_id"

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
    private let statusLabel = UILabel()
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
        statusLabel.numberOfLines = 0
        statusLabel.text = nil
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
        guard let token = readJWT() else {
            showError("Open Sortlist and sign in first.")
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
                case .failure(let message):
                    self.setSaving(false)
                    self.showError(message)
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

    private func showError(_ message: String) {
        statusLabel.text = message
        statusLabel.textColor = Self.danger
    }

    // MARK: - Auth & networking

    /// Reads the JWT the main app wrote at sign-in via expo-secure-store.
    /// The access group is the one declared in BOTH the main app's
    /// entitlements (app.json) and this extension's entitlements (written
    /// by plugins/with-native-share-extension.js).
    ///
    /// The query has to mirror expo-secure-store's exact storage shape:
    ///   - kSecAttrService:     "<keychainService>:<auth|no-auth>"
    ///   - kSecAttrAccount:     Data(<key>.utf8) — the JS-side key as raw bytes
    ///   - kSecAttrAccessGroup: bare access group (iOS prepends team prefix)
    ///
    /// If any of these don't match exactly, SecItemCopyMatching returns
    /// errSecItemNotFound (-25300) and the user sees "Open Sortlist and
    /// sign in first" — even when the token is sitting in the keychain.
    private func readJWT() -> String? {
        let accountData = Data(Self.keychainAccount.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: accountData,
            kSecAttrAccessGroup as String: Self.keychainAccessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status != errSecSuccess {
            // Make this visible in Console.app / xcrun simctl log stream so
            // we don't repeat the silent-keychain-miss debugging cycle.
            NSLog("[SortlistShareExtension] readJWT failed: OSStatus=%d service=%@ group=%@",
                  status, Self.keychainService, Self.keychainAccessGroup)
            return nil
        }
        guard let data = item as? Data, let token = String(data: data, encoding: .utf8) else {
            NSLog("[SortlistShareExtension] readJWT decode failed")
            return nil
        }
        NSLog("[SortlistShareExtension] readJWT success (length=%d)", token.count)
        return token
    }

    enum SaveResult {
        case success
        case failure(String)
    }

    private func postToBackend(urlString: String, token: String, completion: @escaping (SaveResult) -> Void) {
        var request = URLRequest(url: Self.apiURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("\(Self.cookieName)=\(token)", forHTTPHeaderField: "Cookie")

        // tRPC v11 + superjson wire format. The backend's `products.add`
        // accepts `url` + other optional fields; we only send `url` and
        // let the server-side meta scrape + AI auto-assign do the rest.
        let body: [String: Any] = ["json": ["url": urlString]]
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        } catch {
            completion(.failure("Couldn't encode request."))
            return
        }

        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(error.localizedDescription))
                return
            }
            guard let httpResp = response as? HTTPURLResponse else {
                completion(.failure("No response from server."))
                return
            }
            if (200...299).contains(httpResp.statusCode) {
                completion(.success)
                return
            }
            // Surface a useful error from the body if we can. tRPC errors
            // come back as `[{"error":{"json":{"message":"...","data":{"code":"...","httpStatus":...}}}}]`.
            if let data = data,
               let any = try? JSONSerialization.jsonObject(with: data),
               let array = any as? [[String: Any]],
               let first = array.first,
               let err = first["error"] as? [String: Any],
               let json = err["json"] as? [String: Any],
               let message = json["message"] as? String {
                completion(.failure(message))
                return
            }
            completion(.failure("HTTP \(httpResp.statusCode)"))
        }
        task.resume()
    }
}
