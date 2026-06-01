//
//  ShareViewController.swift
//  SortlistShareExtension
//
//  Pure UIKit share extension. No React Native runtime. Mirrors the Sortlist
//  Chrome extension popup: scrape the shared URL via meta.fetch, list the
//  user's sortlists via collections.list, let them pick a target list (or
//  "Let AI decide" or "Create new sortlist"), and POST to products.add.
//
//  All three procedures are non-batched tRPC v11 calls authenticated with
//  the JWT the main app wrote to the shared keychain access group
//  `WPX8584UDS.com.alexesterkin.sortlist` at sign-in time (the team prefix
//  has to be literal at runtime — iOS does NOT auto-prepend it from the
//  signed entitlement, verified empirically in Build 9's diagnostic).
//
//  Auth is Authorization: Bearer ONLY. The backend's authenticateRequest
//  does `cookieToken || bearerToken`, so a present-but-malformed cookie
//  shadows a valid Bearer. We learned that the hard way in Build 4.
//
//  State machine:
//      .loading        - extracting URL, fetching scrape + sortlists
//      .ready          - product preview + picker + save button
//      .saving         - save in flight (button spinner)
//      .success        - "Saved!" + "Go to <list>" + "Back to retailer"
//      .error          - fatal error before save (e.g. unauthorized, no URL)
//
//  Reading the diagnostic that surfaced through Builds 5–10 also lives at
//  the top of readJWT() so future regressions have a reference point.
//

import UIKit
import Security
import UniformTypeIdentifiers
import WebKit

final class ShareViewController: UIViewController {

    // MARK: - Constants

    // Keychain. Literal team-prefixed access group — iOS doesn't auto-prepend
    // the team identifier when given the bare form.
    private static let keychainService = "sortlist:no-auth"
    private static let keychainAccount = "sortlist.session_token"
    private static let keychainAccessGroup = "WPX8584UDS.com.alexesterkin.sortlist"

    // Backend
    private static let baseURL = "https://www.sortlist.shop"

    // Brand colors (must match the React app's tokens — see lib/theme.ts there)
    private static let coral       = UIColor(red: 1.000, green: 0.357, blue: 0.227, alpha: 1.0)
    private static let coralPress  = UIColor(red: 0.870, green: 0.290, blue: 0.180, alpha: 1.0)
    private static let cream       = UIColor(red: 0.980, green: 0.972, blue: 0.953, alpha: 1.0)
    private static let creamMuted  = UIColor(red: 0.945, green: 0.937, blue: 0.918, alpha: 1.0)
    private static let ink         = UIColor(red: 0.102, green: 0.102, blue: 0.102, alpha: 1.0)
    private static let inkMuted    = UIColor(red: 0.102, green: 0.102, blue: 0.102, alpha: 0.55)
    private static let inkSubtle   = UIColor(red: 0.102, green: 0.102, blue: 0.102, alpha: 0.18)
    private static let danger      = UIColor(red: 0.831, green: 0.247, blue: 0.149, alpha: 1.0)
    private static let successHue  = UIColor(red: 0.180, green: 0.560, blue: 0.300, alpha: 1.0)

    // MARK: - Data Types

    struct ScrapedProduct {
        let title: String?
        let imageUrl: String?
        let price: String?
        let currency: String?
        let siteName: String?
    }

    struct Sortlist {
        let id: Int
        let name: String
        let itemCount: Int
    }

    enum CollectionChoice {
        case aiDecide
        case existing(Sortlist)
        case createNew  // text input lives in newListField; name extracted at save
    }

    enum ScreenState {
        case loading(message: String)
        case ready
        case saving
        case success
        case error(message: String, detail: String?)
    }

    // MARK: - State

    private var sharedURL: String?
    private var scrapedProduct: ScrapedProduct?
    private var sortlists: [Sortlist] = []
    private var selectedChoice: CollectionChoice = .aiDecide
    private var jwt: String?
    private var didFinish = false
    private var state: ScreenState = .loading(message: "Loading…") {
        didSet { renderState() }
    }

    // Outcome after save (used by the success screen).
    private var savedCollectionId: Int?
    private var savedCollectionName: String?

    // Strong reference holder for the active on-device WKWebView scraper.
    // Set when we kick off OnDeviceScraper.scrape() and cleared in the
    // completion handler — keeps the scraper alive across the async load.
    private var onDeviceScraper: OnDeviceScraper?

    // 5-second "let the user save anyway" timeout. After the URL is in
    // hand, both the on-device WKWebView scrape and server meta.fetch
    // run in the background to fill in title/image/price. If neither
    // returns within the timeout (slow network, ScraperAPI hiccup, or
    // a particularly slow retailer), we flip to .ready with placeholder
    // metadata so the save button is reachable. Backend continues
    // scraping; the preview card updates in place if data arrives
    // later, but the user is no longer blocked.
    private var readyTimeoutTimer: Timer?
    // Tracks whether we've reached .ready (via fast path OR timeout).
    // Used by loadBackgroundData callbacks to decide whether to also
    // trigger the .ready transition or just refresh the preview card.
    private var hasReachedReady = false

    // MARK: - Subviews

    // Always-present chrome
    private let dimView = UIView()
    private let cardView = UIView()
    private let grabber = UIView()
    private let brandLabel = UILabel()
    private let titleLabel = UILabel()

    // Loading state container
    private let loadingStack = UIStackView()
    private let loadingSpinner = UIActivityIndicatorView(style: .medium)
    private let loadingLabel = UILabel()

    // Ready state — product card
    private let readyStack = UIStackView()
    private let productCard = UIView()
    private let productImageView = UIImageView()
    private let productImagePlaceholder = UIView()
    private let productTextStack = UIStackView()
    private let retailerLabel = UILabel()
    private let productTitleLabel = UILabel()
    private let priceLabel = UILabel()

    // Optional manual-entry price field. Shown ONLY when the scrape
    // didn't return a price (M&S is the canonical case; some COS /
    // ASOS pages too). User can type a price in their native currency
    // notation ("£24.99", "$24.99") — the backend's price parser
    // handles the symbol. Empty = save without a price, no friction.
    // Hides automatically if a late-arriving scrape result populates
    // scrapedProduct.price.
    private let manualPriceField = UITextField()

    // Small explainer line that sits above manualPriceField and names
    // the retailer that didn't share the price ("Marks & Spencer
    // didn't share the price. Add it if you'd like:"). Reframes the
    // field as transparency about a retailer limit rather than an
    // unexplained input. Shown/hidden in lockstep with the field.
    private let manualPriceExplainerLabel = UILabel()

    // Ready state — picker + form
    private let saveToHeader = UILabel()
    private let pickerButton = UIButton(type: .system)
    private let newListField = UITextField()
    private let saveButton = UIButton(type: .system)
    private let saveSpinner = UIActivityIndicatorView(style: .medium)
    private let cancelButton = UIButton(type: .system)
    private let inlineError = UILabel()

    // Success state — minimal, no buttons. Auto-dismisses 1s after
    // landing here so the user goes straight back to Safari (or
    // wherever they shared from). All the previous open-app machinery
    // (responder-chain UIApplication.openURL:, Universal Links,
    // extensionContext.open, deep-link preview, the "Go to sortlist"
    // and "Back to where you were" buttons) is removed — share extensions
    // can't reliably open their host app on iOS 17/26 and the explicit
    // call here is simpler and friction-free.
    private let successStack = UIStackView()
    private let successCheckmark = UILabel()
    private let successHeadline = UILabel()
    private let successDetail = UILabel()

    // Error state (fatal)
    private let errorStack = UIStackView()
    private let errorIcon = UILabel()
    private let errorMessage = UITextView()
    private let errorDetail = UITextView()
    private let errorDismiss = UIButton(type: .system)

    // MARK: - Lifecycle

    override func loadView() {
        view = UIView()
        view.backgroundColor = .clear
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        buildLayout()

        // Read JWT first — if missing, we can short-circuit to an error
        // before bothering with the share-item extraction.
        guard let token = readJWT() else {
            state = .error(
                message: "Open Sortlist and sign in first.",
                detail: nil
            )
            return
        }
        jwt = token

        state = .loading(message: "Reading shared link…")
        extractSharedItem { [weak self] in
            guard let self = self, let rawUrl = self.sharedURL else { return }
            self.continueWithSharedUrl(rawUrl)
        }
    }

    // Post-extraction flow: resolve any redirect-wrapper URLs, set the
    // host-aware loading state, arm the 5s "save anyway" timeout, then
    // fan out to background data loads. The paste-recovery method that
    // used to share this code was removed in v1.1 build 31 when we
    // dropped the JS preprocessor — URL extraction is now reliable
    // enough that recovery isn't needed.
    //
    // Some retailers' in-page Share buttons hand iOS a wrapper / redirect
    // URL (amzn.eu/d/…, share.amazon.com/…, a.co/d/…, bit.ly/…, t.co/…)
    // instead of the actual product page. The HEAD-and-follow lets
    // URLSession follow HTTP 30x to the final URL before we hand it to
    // the scraper. Falls back to the original URL on any error
    // (timeout, non-http(s) chain end, etc.) so worst case is identical
    // to skipping the redirect step.
    //
    // Strong-capture of self in the inner closure is intentional and safe
    // here: the SE process is short-lived, the HEAD has a 4s timeout,
    // and Swift's type-checker chokes on the [weak self] dance inside
    // the inner closure (Build 20/21 compile error). jwt is read from
    // self.jwt which was set during viewDidLoad before any extraction
    // could have completed.
    private func continueWithSharedUrl(_ rawUrl: String) {
        guard let token = self.jwt else {
            state = .error(message: "Open Sortlist and sign in first.", detail: nil)
            return
        }
        self.resolveFinalURL(from: rawUrl) { resolvedUrl in
            DispatchQueue.main.async {
                self.sharedURL = resolvedUrl

                // Seed scrapedProduct with the friendly host name so the
                // loading state can display "Saving from Marks & Spencer…"
                // (rather than a generic spinner with no context). The
                // background scrape will overwrite the placeholder when
                // real data arrives.
                let friendly = self.friendlyHostName(from: resolvedUrl)
                self.scrapedProduct = ScrapedProduct(
                    title: nil,
                    imageUrl: nil,
                    price: nil,
                    currency: nil,
                    siteName: friendly
                )

                self.rebuildPickerMenu()
                self.state = .loading(message: "Saving from \(friendly)…")

                // Arm the 5-second timeout. If neither on-device nor server
                // scrape has returned by then, flip to .ready with what
                // we have (just URL + siteName) so the save button is
                // reachable. Background scrape continues; preview card
                // updates in place if data arrives later.
                self.armReadyTimeout()

                self.loadBackgroundData(url: resolvedUrl, jwt: token)
            }
        }
    }

    // MARK: - Friendly host names + ready-state timing

    /// Map a URL to a user-facing retailer name. Falls back to the
    /// registrable domain title-cased ("marksandspencer.com" → "Marks
    /// and Spencer"-ish). Used in the loading state ("Saving from X…")
    /// and as the placeholder siteName until backend scrape returns.
    ///
    /// The mapping table is intentionally small — just retailers we
    /// know our users save from often or whose domain doesn't title-
    /// case cleanly (M&S, On, Cos, etc.). Anything not in the table
    /// gets the fallback, which produces reasonable results for the
    /// long tail (Quince, Reformation, Costa Farms, etc.).
    private static let retailerFriendlyNames: [String: String] = [
        "amazon.com": "Amazon",
        "amazon.co.uk": "Amazon UK",
        "amazon.de": "Amazon DE",
        "amazon.fr": "Amazon FR",
        "amazon.it": "Amazon IT",
        "amazon.es": "Amazon ES",
        "marksandspencer.com": "Marks & Spencer",
        "asos.com": "ASOS",
        "zara.com": "Zara",
        "zarahome.com": "Zara Home",
        "hm.com": "H&M",
        "www2.hm.com": "H&M",
        "etsy.com": "Etsy",
        "ebay.com": "eBay",
        "ebay.co.uk": "eBay UK",
        "shopdisney.com": "Disney Store",
        "ikea.com": "IKEA",
        "johnlewis.com": "John Lewis",
        "next.co.uk": "Next",
        "argos.co.uk": "Argos",
        "selfridges.com": "Selfridges",
        "harrods.com": "Harrods",
        "anthropologie.com": "Anthropologie",
        "urbanoutfitters.com": "Urban Outfitters",
        "bestbuy.com": "Best Buy",
        "target.com": "Target",
        "walmart.com": "Walmart",
        "nordstrom.com": "Nordstrom",
        "macys.com": "Macy's",
        "saksfifthavenue.com": "Saks",
        "shein.com": "SHEIN",
        "uniqlo.com": "Uniqlo",
        "farfetch.com": "Farfetch",
        "ssense.com": "SSENSE",
        "matchesfashion.com": "Matches",
        "net-a-porter.com": "Net-a-Porter",
        "mrporter.com": "Mr Porter",
        "cos.com": "COS",
        "arket.com": "Arket",
        "weekday.com": "Weekday",
        "monki.com": "Monki",
        "stories.com": "& Other Stories",
        "reformation.com": "Reformation",
        "aritzia.com": "Aritzia",
        "everlane.com": "Everlane",
        "on.com": "On",
        "on-running.com": "On",
        "quince.com": "Quince",
        "onequince.com": "Quince",
        "costafarms.com": "Costa Farms",
        "ikea.co.uk": "IKEA",
        "westelm.com": "West Elm",
        "crateandbarrel.com": "Crate & Barrel",
        "potterybarn.com": "Pottery Barn",
        "wayfair.com": "Wayfair",
        "homedepot.com": "Home Depot",
        "lowes.com": "Lowe's",
        "sephora.com": "Sephora",
        "ulta.com": "Ulta",
    ]

    private func friendlyHostName(from urlString: String) -> String {
        guard let host = URL(string: urlString)?.host?.lowercased() else {
            return "this site"
        }
        let stripped = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        if let mapped = Self.retailerFriendlyNames[stripped] {
            return mapped
        }
        // Fallback: take the registrable label (the segment immediately
        // before the TLD-ish suffix) and title-case it. Not perfect for
        // compound names but reasonable for the long tail.
        let parts = stripped.split(separator: ".")
        if let first = parts.first {
            return String(first).capitalized
        }
        return stripped
    }

    /// Arms the 5-second "save anyway" timeout. Called once per share,
    /// right after continueWithSharedUrl resolves the URL.
    private func armReadyTimeout() {
        readyTimeoutTimer?.invalidate()
        readyTimeoutTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: false) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                NSLog("[SortlistShareExtension] ready-timeout fired — flipping to .ready with placeholder")
                self.transitionToReadyIfNeeded()
            }
        }
    }

    /// Flip to the .ready state if we haven't already. Idempotent —
    /// called from both the timeout AND the scrape-completion paths,
    /// whichever fires first wins. Subsequent calls are no-ops and
    /// just refresh the preview card so late-arriving metadata still
    /// shows up in place.
    private func transitionToReadyIfNeeded() {
        readyTimeoutTimer?.invalidate()
        readyTimeoutTimer = nil
        if !hasReachedReady {
            hasReachedReady = true
            state = .ready
            if let imgUrl = scrapedProduct?.imageUrl, !imgUrl.isEmpty {
                loadProductImage(from: imgUrl)
            }
        } else {
            // Already in .ready — just refresh the card with the
            // latest scrapedProduct values.
            renderProductCard()
            if productImageView.image == nil,
               let imgUrl = scrapedProduct?.imageUrl, !imgUrl.isEmpty {
                loadProductImage(from: imgUrl)
            }
        }
    }

    // [REMOVED v1.1 build 31] Paste-recovery dialog + Sources A/B/C/D
    // fallback chain + diagnostic [SE-fallback] logs lived here.
    // They existed only to work around the fact that the JS preprocessor's
    // webpage-activation mode silently dropped Safari's standard
    // public.url attachment, leaving heavy-CSP retailers (M&S, Zara,
    // ASOS) with no URL to fall back on. The preprocessor is gone in
    // this build; we now activate in URL-only mode (same channel
    // Messages / WhatsApp / Mail use), which delivers public.url
    // reliably for every Safari share. The entire recovery chain is
    // unreachable in normal operation and has been deleted.


    // MARK: - Redirect resolution

    /// HEAD-and-follow-redirects to resolve wrapper URLs like
    /// `amzn.eu/d/abc123`, `share.amazon.com/...`, `a.co/d/...`,
    /// `bit.ly/...`, `t.co/...` to their final product-page URL before
    /// we hand it to the scraper. URLSession follows HTTP 30x redirects
    /// automatically (up to its internal cap of ~10), so we don't need a
    /// custom delegate — `response?.url` is the final URL after the
    /// chain settles.
    ///
    /// Falls back to the original URL on any error path:
    ///   - network error / timeout (4 s)
    ///   - server rejected HEAD (some retailers return 405 — we still
    ///     get the final URL from URLSession's redirect log though)
    ///   - non-http(s) final URL (e.g. chain ends at an app deep link
    ///     like amzn://; URLSession stops at the last http URL in
    ///     that case, but if there's no http URL at all we'd hit this)
    ///   - sharedURL isn't a valid URL or isn't http(s) to begin with
    ///
    /// The completion is called exactly once, with whichever URL we end
    /// up trusting. Bouncing back to main is the caller's job.
    private func resolveFinalURL(from urlString: String, completion: @escaping (String) -> Void) {
        guard let url = URL(string: urlString),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            completion(urlString)
            return
        }

        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 4.0
        config.timeoutIntervalForResource = 5.0
        let session = URLSession(configuration: config)

        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        // Realistic browser UA — some retailers (Amazon especially)
        // serve different redirect chains, or reject outright, when
        // they detect a non-browser client.
        request.setValue(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            forHTTPHeaderField: "User-Agent"
        )

        session.dataTask(with: request) { _, response, error in
            // We don't gate on the response's status code — some servers
            // 405 HEAD but still leave response.url pointing at the
            // resolved URL after URLSession followed the 30x chain.
            if let finalURL = response?.url,
               let finalScheme = finalURL.scheme?.lowercased(),
               (finalScheme == "https" || finalScheme == "http"),
               !finalURL.absoluteString.isEmpty {
                let resolved = finalURL.absoluteString
                if resolved != urlString {
                    NSLog("[SortlistShareExtension] resolved %@ → %@", urlString, resolved)
                }
                completion(resolved)
                return
            }
            if let error = error {
                NSLog("[SortlistShareExtension] redirect resolution failed for %@: %@", urlString, error.localizedDescription)
            }
            completion(urlString)
        }.resume()
    }

    // MARK: - Layout

    private func buildLayout() {
        // Dim background
        dimView.backgroundColor = UIColor.black.withAlphaComponent(0.40)
        dimView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(dimView)
        let tap = UITapGestureRecognizer(target: self, action: #selector(onCancel))
        dimView.addGestureRecognizer(tap)

        // Card
        cardView.backgroundColor = Self.cream
        cardView.layer.cornerRadius = 24
        cardView.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        cardView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(cardView)

        // Grabber
        grabber.backgroundColor = Self.ink.withAlphaComponent(0.12)
        grabber.layer.cornerRadius = 2
        grabber.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(grabber)

        // Brand
        brandLabel.attributedText = NSAttributedString(
            string: "SORTLIST",
            attributes: [
                .kern: 1.5,
                .font: UIFont.systemFont(ofSize: 11, weight: .semibold),
                .foregroundColor: Self.coral,
            ]
        )
        brandLabel.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(brandLabel)

        // Title
        titleLabel.text = "Save to Sortlist"
        titleLabel.font = UIFont.systemFont(ofSize: 22, weight: .semibold)
        titleLabel.textColor = Self.ink
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(titleLabel)

        buildLoadingState()
        buildReadyState()
        buildSuccessState()
        buildErrorState()

        // Always-visible chrome constraints
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
        ])
    }

    private func buildLoadingState() {
        loadingSpinner.color = Self.inkMuted
        loadingSpinner.translatesAutoresizingMaskIntoConstraints = false
        loadingSpinner.startAnimating()

        loadingLabel.font = UIFont.systemFont(ofSize: 14)
        loadingLabel.textColor = Self.inkMuted
        loadingLabel.textAlignment = .center
        loadingLabel.numberOfLines = 0
        loadingLabel.translatesAutoresizingMaskIntoConstraints = false

        loadingStack.axis = .vertical
        loadingStack.spacing = 16
        loadingStack.alignment = .center
        loadingStack.addArrangedSubview(loadingSpinner)
        loadingStack.addArrangedSubview(loadingLabel)
        loadingStack.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(loadingStack)

        NSLayoutConstraint.activate([
            loadingStack.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 32),
            loadingStack.leadingAnchor.constraint(equalTo: cardView.leadingAnchor, constant: 24),
            loadingStack.trailingAnchor.constraint(equalTo: cardView.trailingAnchor, constant: -24),
            loadingStack.bottomAnchor.constraint(equalTo: cardView.safeAreaLayoutGuide.bottomAnchor, constant: -32),
        ])
    }

    private func buildReadyState() {
        // ─── Product card ────────────────────────────────────────────────
        productCard.backgroundColor = Self.creamMuted
        productCard.layer.cornerRadius = 12
        productCard.translatesAutoresizingMaskIntoConstraints = false

        productImagePlaceholder.backgroundColor = Self.inkSubtle.withAlphaComponent(0.10)
        productImagePlaceholder.layer.cornerRadius = 8
        productImagePlaceholder.translatesAutoresizingMaskIntoConstraints = false
        productCard.addSubview(productImagePlaceholder)

        productImageView.contentMode = .scaleAspectFill
        productImageView.clipsToBounds = true
        productImageView.layer.cornerRadius = 8
        productImageView.backgroundColor = .clear
        productImageView.translatesAutoresizingMaskIntoConstraints = false
        productCard.addSubview(productImageView)

        retailerLabel.font = UIFont.systemFont(ofSize: 10, weight: .semibold)
        retailerLabel.textColor = Self.coral
        retailerLabel.numberOfLines = 1
        retailerLabel.translatesAutoresizingMaskIntoConstraints = false

        productTitleLabel.font = UIFont.systemFont(ofSize: 14, weight: .medium)
        productTitleLabel.textColor = Self.ink
        productTitleLabel.numberOfLines = 2
        productTitleLabel.translatesAutoresizingMaskIntoConstraints = false

        priceLabel.font = UIFont.systemFont(ofSize: 15, weight: .semibold)
        priceLabel.textColor = Self.ink
        priceLabel.numberOfLines = 1
        priceLabel.translatesAutoresizingMaskIntoConstraints = false

        productTextStack.axis = .vertical
        productTextStack.spacing = 4
        productTextStack.alignment = .leading
        productTextStack.addArrangedSubview(retailerLabel)
        productTextStack.addArrangedSubview(productTitleLabel)
        productTextStack.addArrangedSubview(priceLabel)
        productTextStack.translatesAutoresizingMaskIntoConstraints = false
        productCard.addSubview(productTextStack)

        // ─── Picker section ──────────────────────────────────────────────
        saveToHeader.attributedText = NSAttributedString(
            string: "SAVE TO SORTLIST",
            attributes: [
                .kern: 1.2,
                .font: UIFont.systemFont(ofSize: 10, weight: .semibold),
                .foregroundColor: Self.inkMuted,
            ]
        )
        saveToHeader.translatesAutoresizingMaskIntoConstraints = false

        configurePickerButton()

        newListField.borderStyle = .none
        newListField.backgroundColor = Self.cream
        newListField.layer.borderWidth = 1
        newListField.layer.borderColor = Self.inkSubtle.cgColor
        newListField.layer.cornerRadius = 10
        newListField.font = UIFont.systemFont(ofSize: 15)
        newListField.textColor = Self.ink
        newListField.placeholder = "Sortlist name"
        newListField.autocapitalizationType = .words
        newListField.returnKeyType = .done
        newListField.delegate = self
        newListField.isHidden = true
        // Inset the text from the border
        let leftPad = UIView(frame: CGRect(x: 0, y: 0, width: 14, height: 1))
        newListField.leftView = leftPad
        newListField.leftViewMode = .always
        newListField.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 14, height: 1))
        newListField.rightViewMode = .always
        newListField.translatesAutoresizingMaskIntoConstraints = false
        newListField.addTarget(self, action: #selector(onNewListChanged), for: .editingChanged)

        // ─── CTA + cancel ────────────────────────────────────────────────
        styleCoralPrimary(saveButton, title: "Save to Sortlist")
        saveButton.addTarget(self, action: #selector(onSave), for: .touchUpInside)
        saveButton.translatesAutoresizingMaskIntoConstraints = false

        saveSpinner.color = .white
        saveSpinner.hidesWhenStopped = true
        saveSpinner.translatesAutoresizingMaskIntoConstraints = false
        saveButton.addSubview(saveSpinner)

        styleTextButton(cancelButton, title: "Cancel")
        cancelButton.addTarget(self, action: #selector(onCancel), for: .touchUpInside)
        cancelButton.translatesAutoresizingMaskIntoConstraints = false

        inlineError.font = UIFont.systemFont(ofSize: 12, weight: .medium)
        inlineError.textColor = Self.danger
        inlineError.numberOfLines = 2
        inlineError.isHidden = true
        inlineError.translatesAutoresizingMaskIntoConstraints = false

        // Optional manual price field — see field declaration comment.
        // Hidden by default; renderState/.ready and renderProductCard
        // flip visibility based on whether scrapedProduct.price is set.
        // Explainer label — small, ink-muted. Text is set per-share in
        // updateManualPriceFieldVisibility once we know the retailer
        // name (defaulting to "This site" if scrapedProduct.siteName
        // is nil for any reason). Sits directly above the field with
        // a tight 4pt gap.
        manualPriceExplainerLabel.font = UIFont.systemFont(ofSize: 12, weight: .regular)
        manualPriceExplainerLabel.textColor = Self.inkMuted
        manualPriceExplainerLabel.numberOfLines = 1
        manualPriceExplainerLabel.lineBreakMode = .byTruncatingTail
        manualPriceExplainerLabel.isHidden = true
        manualPriceExplainerLabel.translatesAutoresizingMaskIntoConstraints = false

        // Use attributedPlaceholder rather than .placeholder so the
        // placeholder colour is explicit — default UITextField placeholder
        // opacity reads as washed-out against our cream backgrounds.
        // inkMuted (0.55 alpha) matches the existing brand-system
        // muted-text treatment used by inlineError fallbacks, loading
        // label, and the SAVE TO SORTLIST eyebrow.
        manualPriceField.attributedPlaceholder = NSAttributedString(
            string: "£0.00",
            attributes: [.foregroundColor: Self.inkMuted]
        )
        manualPriceField.font = UIFont.systemFont(ofSize: 15)
        manualPriceField.textColor = Self.ink
        manualPriceField.backgroundColor = Self.cream
        manualPriceField.borderStyle = .none
        manualPriceField.layer.cornerRadius = 10
        manualPriceField.layer.borderWidth = 1
        manualPriceField.layer.borderColor = Self.inkSubtle.cgColor
        // Match the existing newListField padding pattern (leftView/
        // rightView spacer views) — UITextField doesn't have a native
        // padding property and other approaches break layout in
        // unexpected ways inside UIStackView arranged subviews.
        let priceLeftPad = UIView(frame: CGRect(x: 0, y: 0, width: 14, height: 1))
        manualPriceField.leftView = priceLeftPad
        manualPriceField.leftViewMode = .always
        manualPriceField.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 14, height: 1))
        manualPriceField.rightViewMode = .always
        // .numbersAndPunctuation lets users type "£24.99" / "$24.99"
        // without switching keyboards. Backend price parser accepts
        // raw values with symbols.
        manualPriceField.keyboardType = .numbersAndPunctuation
        manualPriceField.autocorrectionType = .no
        manualPriceField.autocapitalizationType = .none
        manualPriceField.returnKeyType = .done
        manualPriceField.delegate = self
        manualPriceField.isHidden = true
        manualPriceField.translatesAutoresizingMaskIntoConstraints = false

        readyStack.axis = .vertical
        readyStack.spacing = 14
        readyStack.alignment = .fill
        readyStack.addArrangedSubview(productCard)
        readyStack.addArrangedSubview(manualPriceExplainerLabel)
        readyStack.addArrangedSubview(manualPriceField)
        readyStack.addArrangedSubview(saveToHeader)
        readyStack.addArrangedSubview(pickerButton)
        readyStack.addArrangedSubview(newListField)
        readyStack.addArrangedSubview(inlineError)
        readyStack.addArrangedSubview(saveButton)
        readyStack.addArrangedSubview(cancelButton)
        // Tight 4pt between the explainer line and the field so they
        // read as a unit. Default 14pt would feel like two unrelated
        // pieces.
        readyStack.setCustomSpacing(4, after: manualPriceExplainerLabel)
        readyStack.setCustomSpacing(8, after: saveToHeader)
        readyStack.setCustomSpacing(10, after: pickerButton)
        readyStack.setCustomSpacing(10, after: newListField)
        readyStack.setCustomSpacing(18, after: inlineError)
        readyStack.setCustomSpacing(6, after: saveButton)
        // Pin the manual price field height to match the other form
        // controls (44pt is the standard iOS touch-target minimum).
        manualPriceField.heightAnchor.constraint(equalToConstant: 44).isActive = true
        readyStack.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(readyStack)

        NSLayoutConstraint.activate([
            // Product card internals
            productImagePlaceholder.topAnchor.constraint(equalTo: productCard.topAnchor, constant: 12),
            productImagePlaceholder.leadingAnchor.constraint(equalTo: productCard.leadingAnchor, constant: 12),
            productImagePlaceholder.bottomAnchor.constraint(equalTo: productCard.bottomAnchor, constant: -12),
            productImagePlaceholder.widthAnchor.constraint(equalToConstant: 72),
            productImagePlaceholder.heightAnchor.constraint(equalToConstant: 72),

            productImageView.topAnchor.constraint(equalTo: productImagePlaceholder.topAnchor),
            productImageView.leadingAnchor.constraint(equalTo: productImagePlaceholder.leadingAnchor),
            productImageView.trailingAnchor.constraint(equalTo: productImagePlaceholder.trailingAnchor),
            productImageView.bottomAnchor.constraint(equalTo: productImagePlaceholder.bottomAnchor),

            productTextStack.leadingAnchor.constraint(equalTo: productImagePlaceholder.trailingAnchor, constant: 12),
            productTextStack.trailingAnchor.constraint(equalTo: productCard.trailingAnchor, constant: -12),
            productTextStack.centerYAnchor.constraint(equalTo: productCard.centerYAnchor),
            productTextStack.topAnchor.constraint(greaterThanOrEqualTo: productCard.topAnchor, constant: 12),
            productTextStack.bottomAnchor.constraint(lessThanOrEqualTo: productCard.bottomAnchor, constant: -12),

            // Heights
            pickerButton.heightAnchor.constraint(equalToConstant: 48),
            newListField.heightAnchor.constraint(equalToConstant: 48),
            saveButton.heightAnchor.constraint(equalToConstant: 52),
            cancelButton.heightAnchor.constraint(equalToConstant: 36),

            saveSpinner.centerXAnchor.constraint(equalTo: saveButton.centerXAnchor),
            saveSpinner.centerYAnchor.constraint(equalTo: saveButton.centerYAnchor),

            // Stack placement
            readyStack.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 18),
            readyStack.leadingAnchor.constraint(equalTo: cardView.leadingAnchor, constant: 24),
            readyStack.trailingAnchor.constraint(equalTo: cardView.trailingAnchor, constant: -24),
            readyStack.bottomAnchor.constraint(equalTo: cardView.safeAreaLayoutGuide.bottomAnchor, constant: -16),
        ])
    }

    private func buildSuccessState() {
        successCheckmark.text = "✓"
        successCheckmark.font = UIFont.systemFont(ofSize: 56, weight: .bold)
        successCheckmark.textColor = Self.successHue
        successCheckmark.textAlignment = .center
        successCheckmark.translatesAutoresizingMaskIntoConstraints = false

        successHeadline.text = "Saved!"
        successHeadline.font = UIFont.systemFont(ofSize: 24, weight: .semibold)
        successHeadline.textColor = Self.ink
        successHeadline.textAlignment = .center
        successHeadline.translatesAutoresizingMaskIntoConstraints = false

        successDetail.font = UIFont.systemFont(ofSize: 15)
        successDetail.textColor = Self.inkMuted
        successDetail.textAlignment = .center
        successDetail.numberOfLines = 0
        successDetail.translatesAutoresizingMaskIntoConstraints = false

        successStack.axis = .vertical
        successStack.alignment = .fill
        successStack.spacing = 8
        successStack.addArrangedSubview(successCheckmark)
        successStack.addArrangedSubview(successHeadline)
        successStack.addArrangedSubview(successDetail)
        successStack.setCustomSpacing(6, after: successCheckmark)
        successStack.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(successStack)

        NSLayoutConstraint.activate([
            successStack.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 32),
            successStack.leadingAnchor.constraint(equalTo: cardView.leadingAnchor, constant: 24),
            successStack.trailingAnchor.constraint(equalTo: cardView.trailingAnchor, constant: -24),
            successStack.bottomAnchor.constraint(equalTo: cardView.safeAreaLayoutGuide.bottomAnchor, constant: -32),
        ])
    }

    private func buildErrorState() {
        errorIcon.text = "⚠"
        errorIcon.font = UIFont.systemFont(ofSize: 36, weight: .bold)
        errorIcon.textColor = Self.danger
        errorIcon.textAlignment = .center
        errorIcon.translatesAutoresizingMaskIntoConstraints = false

        errorMessage.isEditable = false
        errorMessage.isSelectable = true
        errorMessage.isScrollEnabled = false
        errorMessage.backgroundColor = .clear
        errorMessage.textContainer.lineFragmentPadding = 0
        errorMessage.textContainerInset = .zero
        errorMessage.dataDetectorTypes = []
        errorMessage.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        errorMessage.textColor = Self.danger
        errorMessage.textAlignment = .center
        errorMessage.translatesAutoresizingMaskIntoConstraints = false

        errorDetail.isEditable = false
        errorDetail.isSelectable = true
        errorDetail.isScrollEnabled = false
        errorDetail.backgroundColor = .clear
        errorDetail.textContainer.lineFragmentPadding = 0
        errorDetail.textContainerInset = .zero
        errorDetail.dataDetectorTypes = []
        errorDetail.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        errorDetail.textColor = Self.inkMuted
        errorDetail.translatesAutoresizingMaskIntoConstraints = false

        styleTextButton(errorDismiss, title: "Close")
        errorDismiss.addTarget(self, action: #selector(onCancel), for: .touchUpInside)
        errorDismiss.translatesAutoresizingMaskIntoConstraints = false

        errorStack.axis = .vertical
        errorStack.alignment = .fill
        errorStack.spacing = 12
        errorStack.addArrangedSubview(errorIcon)
        errorStack.addArrangedSubview(errorMessage)
        errorStack.addArrangedSubview(errorDetail)
        errorStack.addArrangedSubview(errorDismiss)
        errorStack.setCustomSpacing(20, after: errorDetail)
        errorStack.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(errorStack)

        NSLayoutConstraint.activate([
            errorStack.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 24),
            errorStack.leadingAnchor.constraint(equalTo: cardView.leadingAnchor, constant: 24),
            errorStack.trailingAnchor.constraint(equalTo: cardView.trailingAnchor, constant: -24),
            errorStack.bottomAnchor.constraint(equalTo: cardView.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            errorDismiss.heightAnchor.constraint(equalToConstant: 44),
        ])
    }

    // MARK: - Button styling helpers

    private func styleCoralPrimary(_ button: UIButton, title: String) {
        button.setTitle(title, for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .semibold)
        button.backgroundColor = Self.coral
        button.layer.cornerRadius = 14
    }

    private func styleTextButton(_ button: UIButton, title: String) {
        button.setTitle(title, for: .normal)
        button.setTitleColor(Self.inkMuted, for: .normal)
        button.titleLabel?.font = UIFont.systemFont(ofSize: 14)
        button.backgroundColor = .clear
    }

    private func configurePickerButton() {
        pickerButton.backgroundColor = Self.cream
        pickerButton.layer.borderWidth = 1
        pickerButton.layer.borderColor = Self.inkSubtle.cgColor
        pickerButton.layer.cornerRadius = 10
        pickerButton.contentHorizontalAlignment = .left
        pickerButton.tintColor = Self.ink
        pickerButton.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        pickerButton.setTitleColor(Self.ink, for: .normal)
        pickerButton.translatesAutoresizingMaskIntoConstraints = false
        // Inset content
        pickerButton.contentEdgeInsets = UIEdgeInsets(top: 0, left: 14, bottom: 0, right: 36)
        // Chevron on the right
        let chevron = UIImageView(image: UIImage(systemName: "chevron.up.chevron.down"))
        chevron.tintColor = Self.inkMuted
        chevron.translatesAutoresizingMaskIntoConstraints = false
        pickerButton.addSubview(chevron)
        NSLayoutConstraint.activate([
            chevron.trailingAnchor.constraint(equalTo: pickerButton.trailingAnchor, constant: -14),
            chevron.centerYAnchor.constraint(equalTo: pickerButton.centerYAnchor),
            chevron.widthAnchor.constraint(equalToConstant: 14),
            chevron.heightAnchor.constraint(equalToConstant: 18),
        ])
        pickerButton.showsMenuAsPrimaryAction = true
        rebuildPickerMenu()
        updatePickerLabel()
    }

    // MARK: - Render state

    private func renderState() {
        let isLoading: Bool, isReady: Bool, isSuccess: Bool, isError: Bool
        switch state {
        case .loading: isLoading = true;  isReady = false; isSuccess = false; isError = false
        case .ready:   isLoading = false; isReady = true;  isSuccess = false; isError = false
        case .saving:  isLoading = false; isReady = true;  isSuccess = false; isError = false
        case .success: isLoading = false; isReady = false; isSuccess = true;  isError = false
        case .error:   isLoading = false; isReady = false; isSuccess = false; isError = true
        }

        loadingStack.isHidden = !isLoading
        readyStack.isHidden   = !isReady
        successStack.isHidden = !isSuccess
        errorStack.isHidden   = !isError

        switch state {
        case .loading(let message):
            loadingLabel.text = message
            loadingSpinner.startAnimating()
            titleLabel.text = "Save to Sortlist"

        case .ready:
            titleLabel.text = "Save to Sortlist"
            saveButton.isEnabled = isSaveEnabled()
            saveButton.alpha = saveButton.isEnabled ? 1.0 : 0.5
            saveSpinner.stopAnimating()
            saveButton.setTitle(saveButtonLabel(), for: .normal)
            renderProductCard()

        case .saving:
            titleLabel.text = "Save to Sortlist"
            saveButton.isEnabled = false
            saveButton.setTitle("", for: .normal)
            saveSpinner.startAnimating()
            inlineError.isHidden = true

        case .success:
            // Title is just the headline now; the "Saved!" word is in the
            // body of the card via successHeadline so the title bar can
            // stay focused on the card type.
            titleLabel.text = "Save to Sortlist"
            if let name = savedCollectionName, !name.isEmpty {
                successDetail.text = "Added to \(name)"
            } else {
                // AI returned low confidence and no name we can show — the
                // product is saved but uncategorised. Keep the message
                // honest rather than implying it landed somewhere it
                // didn't.
                successDetail.text = "Saved"
            }

        case .error(let message, let detail):
            titleLabel.text = "Something went wrong"
            errorMessage.text = message
            if let detail = detail, !detail.isEmpty {
                errorDetail.text = detail
                errorDetail.isHidden = false
            } else {
                errorDetail.text = ""
                errorDetail.isHidden = true
            }
        }
    }

    private func renderProductCard() {
        let retailer = displayRetailer()
        retailerLabel.text = retailer

        if let title = scrapedProduct?.title, !title.isEmpty {
            productTitleLabel.text = title
        } else {
            productTitleLabel.text = sharedURL ?? "Untitled"
        }

        if let priceText = displayPrice() {
            priceLabel.text = priceText
            priceLabel.isHidden = false
        } else {
            priceLabel.text = nil
            priceLabel.isHidden = true
        }

        if productImageView.image == nil {
            productImagePlaceholder.isHidden = false
        }

        updateManualPriceFieldVisibility()
    }

    /// Show the optional manual price field + its retailer-named
    /// explainer line iff no scraped price is available. Called from
    /// renderProductCard so they stay in sync with every scrape update
    /// — if a late-arriving server scrape fills in the price, both
    /// hide (and any value the user typed is discarded in favour of
    /// the scrape). Inverse: if scrape returns empty price, both
    /// appear with the retailer name slotted in.
    private func updateManualPriceFieldVisibility() {
        let havePrice = (scrapedProduct?.price?.isEmpty == false)
        let shouldShow = !havePrice

        // Set the explainer text using the friendly retailer name
        // already populated on scrapedProduct.siteName (seeded by
        // continueWithSharedUrl's friendlyHostName call). Falls back
        // to "This site" if siteName is somehow nil — defensive.
        let retailer = scrapedProduct?.siteName ?? "This site"
        manualPriceExplainerLabel.text =
            "\(retailer) didn’t share the price. Add it if you’d like:"

        if manualPriceField.isHidden == shouldShow {
            manualPriceField.isHidden = !shouldShow
        }
        if manualPriceExplainerLabel.isHidden == shouldShow {
            manualPriceExplainerLabel.isHidden = !shouldShow
        }
        if havePrice {
            // Scrape filled in the price after the user already typed
            // something — clear the stale manual value so it doesn't
            // sneak into the save payload via the fallback path.
            manualPriceField.text = nil
        }
    }

    private func displayRetailer() -> String {
        if let siteName = scrapedProduct?.siteName, !siteName.isEmpty {
            return siteName.uppercased()
        }
        if let urlString = sharedURL, let url = URL(string: urlString), let host = url.host {
            let bare = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
            return bare.uppercased()
        }
        return "WEB"
    }

    private func displayPrice() -> String? {
        guard let price = scrapedProduct?.price, !price.isEmpty else { return nil }
        let currency = scrapedProduct?.currency ?? ""
        let symbols: Set<String> = ["£", "$", "€", "¥"]
        if symbols.contains(currency) {
            return "\(currency)\(price)"
        }
        if !currency.isEmpty {
            return "\(currency) \(price)"
        }
        return price
    }

    // MARK: - Picker

    private func rebuildPickerMenu() {
        var children: [UIMenuElement] = []

        let aiOn = (isAIDecide() ? UIMenuElement.State.on : .off)
        let aiAction = UIAction(
            title: "Let AI decide",
            image: UIImage(systemName: "sparkles"),
            state: aiOn
        ) { [weak self] _ in self?.select(.aiDecide) }
        children.append(aiAction)

        if !sortlists.isEmpty {
            var lists: [UIMenuElement] = []
            for list in sortlists {
                let chosen = (isExisting(list) ? UIMenuElement.State.on : .off)
                let action = UIAction(
                    title: list.name,
                    subtitle: list.itemCount == 1 ? "1 item" : "\(list.itemCount) items",
                    state: chosen
                ) { [weak self] _ in self?.select(.existing(list)) }
                lists.append(action)
            }
            let existingMenu = UIMenu(title: "Your sortlists", options: .displayInline, children: lists)
            children.append(existingMenu)
        }

        let createOn = (isCreatingNew() ? UIMenuElement.State.on : .off)
        let createAction = UIAction(
            title: "Create new sortlist…",
            image: UIImage(systemName: "plus.circle"),
            state: createOn
        ) { [weak self] _ in self?.select(.createNew) }
        children.append(createAction)

        pickerButton.menu = UIMenu(title: "", children: children)
    }

    private func updatePickerLabel() {
        switch selectedChoice {
        case .aiDecide:
            pickerButton.setTitle("✨   Let AI decide", for: .normal)
        case .existing(let list):
            pickerButton.setTitle(list.name, for: .normal)
        case .createNew:
            pickerButton.setTitle("✚   Create new sortlist", for: .normal)
        }
    }

    private func select(_ choice: CollectionChoice) {
        selectedChoice = choice
        switch choice {
        case .createNew:
            newListField.isHidden = false
            newListField.becomeFirstResponder()
        default:
            newListField.isHidden = true
            view.endEditing(true)
        }
        updatePickerLabel()
        rebuildPickerMenu()
        // Re-render save button state
        saveButton.isEnabled = isSaveEnabled()
        saveButton.alpha = saveButton.isEnabled ? 1.0 : 0.5
        saveButton.setTitle(saveButtonLabel(), for: .normal)
    }

    private func isAIDecide() -> Bool {
        if case .aiDecide = selectedChoice { return true }
        return false
    }

    private func isExisting(_ list: Sortlist) -> Bool {
        if case .existing(let s) = selectedChoice, s.id == list.id { return true }
        return false
    }

    private func isCreatingNew() -> Bool {
        if case .createNew = selectedChoice { return true }
        return false
    }

    private func isSaveEnabled() -> Bool {
        switch selectedChoice {
        case .aiDecide, .existing:
            return true
        case .createNew:
            return !(newListField.text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
        }
    }

    private func saveButtonLabel() -> String {
        // "Save anyway" wording when we reached .ready via the 5s timeout
        // without any scrape data — signals to the user that they're
        // saving with URL only and that we couldn't auto-detect details.
        // The save still goes through; backend continues scraping in the
        // background after the share extension closes.
        let scrapeIncomplete = (scrapedProduct?.title?.isEmpty ?? true)
            && (scrapedProduct?.imageUrl?.isEmpty ?? true)
        switch selectedChoice {
        case .createNew:
            return scrapeIncomplete ? "Create & Save anyway" : "Create & Save"
        default:
            return scrapeIncomplete ? "Save anyway" : "Save to Sortlist"
        }
    }

    @objc private func onNewListChanged() {
        saveButton.isEnabled = isSaveEnabled()
        saveButton.alpha = saveButton.isEnabled ? 1.0 : 0.5
    }

    // MARK: - Share intake
    //
    // Many retailer apps (Zara, H&M, ASOS, Amazon, eBay, Vinted…) hand
    // iOS share payloads with MULTIPLE NSItemProviders per NSExtensionItem,
    // sometimes ALSO spread across multiple NSExtensionItems. A typical
    // shape is { plain-text description } + { public.url product URL }.
    //
    // The old loop walked items one at a time and within each item picked
    // the first provider with a known UTI, then returned. That failed
    // whenever the FIRST provider was a description-text-with-no-URL: we
    // hit the "no link in text" branch and never inspected the next
    // provider (let alone the next item) which actually had the URL.
    //
    // The new flow:
    //   1. Flatten ALL providers across ALL inputItems into one ordered list.
    //   2. JS preprocessor (Safari → loaded page): one provider, gives
    //      both URL and scraped OG metadata.
    //   3. Any public.url provider, anywhere in the flattened list.
    //   4. Any text provider (public.plain-text or public.text), regex-extract.
    //      Try each one in turn — the first that yields a URL wins.
    //   5. Error: nothing extractable.

    private func extractSharedItem(completion: @escaping () -> Void) {
        guard let extensionContext = extensionContext else {
            state = .error(message: "No share context.", detail: nil)
            return
        }

        var allAttachments: [NSItemProvider] = []
        for item in extensionContext.inputItems {
            guard let ei = item as? NSExtensionItem else { continue }
            if let atts = ei.attachments {
                allAttachments.append(contentsOf: atts)
            }
        }
        if allAttachments.isEmpty {
            // With URL-only activation, Safari always passes at least a
            // public.url attachment for webpage shares. Hitting this
            // branch means a non-Safari host activated us with an empty
            // payload — genuinely nothing we can do. Hard error.
            state = .error(
                message: "Nothing to share.",
                detail: "Open a product page in Safari and try Share again."
            )
            return
        }

        // URL-only activation channel: Step 1 (JS preprocessor) was removed
        // in v1.1 build 31 — see the comment block above (and Info.plist).
        // We now go straight to the public.url provider, with text-attachment
        // regex extraction as a fallback for non-browser apps that share
        // plain text containing a URL.
        extractFromUrlOrText(all: allAttachments, completion: completion)
    }

    /// Walks the (already-flattened) attachment list looking for any
    /// public.url provider first, then any text provider with an embedded
    /// URL. The "url first across the entire payload" rule is what fixes
    /// the Zara/multi-item bug — retailers commonly attach a plain-text
    /// description AND a separate public.url provider, and we need to
    /// reach the URL regardless of which one comes first in the array.
    private func extractFromUrlOrText(
        all: [NSItemProvider],
        completion: @escaping () -> Void
    ) {
        if let urlProvider = all.first(where: {
            $0.hasItemConformingToTypeIdentifier(UTType.url.identifier)
        }) {
            urlProvider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] data, _ in
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    if let url = data as? URL {
                        self.sharedURL = url.absoluteString
                        completion()
                        return
                    }
                    if let str = data as? String, let parsed = URL(string: str) {
                        self.sharedURL = parsed.absoluteString
                        completion()
                        return
                    }
                    // URL provider loaded but couldn't be parsed — fall
                    // back to scanning text providers for an embedded URL.
                    self.extractFromText(all: all, completion: completion)
                }
            }
            return
        }
        extractFromText(all: all, completion: completion)
    }

    /// Last-resort: scan every text provider (public.plain-text AND the
    /// more general public.text) for an embedded URL via regex. Tries
    /// them in payload order; first match wins.
    private func extractFromText(
        all: [NSItemProvider],
        completion: @escaping () -> Void
    ) {
        let textIds = [UTType.plainText.identifier, UTType.text.identifier]
        let textProviders: [(NSItemProvider, String)] = all.compactMap { provider in
            for tid in textIds where provider.hasItemConformingToTypeIdentifier(tid) {
                return (provider, tid)
            }
            return nil
        }
        if textProviders.isEmpty {
            // URL-only activation: Safari always delivers public.url, so
            // we never expect to reach this branch from a Safari share.
            // Non-Safari hosts may pass neither URL nor text — error out.
            state = .error(
                message: "Couldn't read shared content.",
                detail: "Open a product page in Safari and try Share again."
            )
            return
        }
        tryNextTextProvider(textProviders, index: 0, completion: completion)
    }

    private func tryNextTextProvider(
        _ providers: [(NSItemProvider, String)],
        index: Int,
        completion: @escaping () -> Void
    ) {
        if index >= providers.count {
            state = .error(
                message: "No link found in shared text.",
                detail: nil
            )
            return
        }
        let (provider, typeId) = providers[index]
        provider.loadItem(forTypeIdentifier: typeId, options: nil) { [weak self] data, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if let text = data as? String,
                   let range = text.range(of: #"https?://\S+"#, options: .regularExpression) {
                    self.sharedURL = String(text[range])
                    completion()
                    return
                }
                // Nothing in this one — try the next.
                self.tryNextTextProvider(providers, index: index + 1, completion: completion)
            }
        }
    }

    // MARK: - Background data load
    //
    // Runs AFTER the ready state is already on screen, populated from the
    // JS preprocessor result. Fills in two things:
    //
    //   collections.list — needed to populate the picker menu. Always
    //     fired; on success we rebuild the menu in place. On failure
    //     the picker just shows "Let AI decide" + "Create new sortlist…".
    //
    //   meta.fetch — only fired if the JS preprocessor came back missing
    //     a key field (title or image). Server-side scrape has retailer
    //     adapters / Playwright / LLM fallback that the local JS can't
    //     match. We merge non-nil server values into any nil slots in
    //     scrapedProduct, so anything the JS already got stays as
    //     the source of truth.

    private func loadBackgroundData(url: String, jwt: String) {
        fetchSortlists(jwt: jwt) { [weak self] result in
            DispatchQueue.main.async {
                guard let self = self else { return }
                switch result {
                case .success(let ls):
                    self.sortlists = ls
                    self.rebuildPickerMenu()
                case .failure(let msg):
                    NSLog("[SortlistShareExtension] collections.list failed: %@", msg)
                }
            }
        }

        // Two-tier scrape chain. With URL-only activation we never have
        // preprocessor data to start with, so the scrape ALWAYS runs:
        //   1. OnDeviceScraper — load the URL in a hidden WKWebView from
        //      the user's actual iPhone IP. Most reliable: real Safari
        //      fingerprint + residential IP defeats the bot blockers that
        //      reject our datacenter IP at the server.
        //   2. Server meta.fetch — fallback when on-device scrape times
        //      out or returns no usable data (cold device, page requires
        //      login, etc.).
        //
        // Each completion calls transitionToReadyIfNeeded — first to fire
        // flips us out of .loading into .ready (the 5-second armReadyTimeout
        // is the third path that can do this). Subsequent calls just
        // refresh the preview card in place so late-arriving metadata
        // still shows up without disrupting the user.
        runOnDeviceScrape(urlString: url) { [weak self] scraped in
            guard let self = self else { return }
            if let scraped = scraped {
                self.mergeScrapedData(scraped)
                self.transitionToReadyIfNeeded()
                // If the on-device path gave us both title AND image,
                // skip the server round-trip — we have enough.
                if self.scrapedProduct?.title != nil
                    && self.scrapedProduct?.imageUrl != nil {
                    return
                }
            }
            // On-device scrape failed or returned partial data.
            // Fall back to server meta.fetch to fill in any gaps.
            self.fetchScrapedProduct(url: url, jwt: jwt) { [weak self] result in
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    switch result {
                    case .success(let server):
                        self.mergeScrapedData(server)
                    case .failure(let msg):
                        NSLog("[SortlistShareExtension] meta.fetch failed: %@", msg)
                        // Even on failure, transition to ready so the
                        // save button is reachable. mergeScrapedData
                        // wasn't called, so scrapedProduct stays at
                        // whatever we have (placeholder siteName +
                        // anything the on-device pass managed to add).
                    }
                    self.transitionToReadyIfNeeded()
                }
            }
        }
    }

    /// Bot-block / anti-scraper title patterns. Substring match,
    /// case-insensitive. Matched against the title field only — these
    /// phrases are unique enough that no legitimate product title
    /// would contain them, and the title is the most reliable signal
    /// (image URLs to block pages vary too much across retailers to
    /// enumerate). Triggered by Zara Home flicker (Build 31): server
    /// meta.fetch returned "Access Denied" from datacenter IPs and
    /// the merge briefly displayed it before on-device's residential-IP
    /// scrape result. Now we discard the whole incoming scrape if
    /// its title matches any of these — preserves whatever the
    /// previous merge stored (typically the real on-device result).
    private static let botBlockTitlePatterns: [String] = [
        "access denied",
        "robot check",
        "are you human",
        "verify you are human",
        "just a moment",
        "pardon our interruption",
        "checking your browser",
        "please enable javascript",
        "please enable cookies",
        "captcha",
        "ddos-guard",
        "cf-browser-verification",
        "unusual traffic",
        "security check",
        "forbidden",
        "blocked by",
    ]

    private func isLikelyBotBlock(_ data: ScrapedProduct) -> Bool {
        guard let title = data.title?.lowercased(), !title.isEmpty else {
            return false
        }
        for pattern in Self.botBlockTitlePatterns {
            if title.contains(pattern) {
                return true
            }
        }
        return false
    }

    /// Merge an incoming ScrapedProduct into self.scrapedProduct, preferring
    /// existing values and filling in nils from the new one. Used by both
    /// the on-device WKWebView path and the server meta.fetch fallback.
    ///
    /// Front gate: if the incoming scrape's title matches a known
    /// anti-bot block phrase ("Access Denied", "Just a moment",
    /// "Blocked by Cloudflare", etc.), discard the ENTIRE incoming
    /// payload — including image/price/siteName, since on a block
    /// page those fields are equally garbage (default logos, $0,
    /// generic site name). The previous merge result (typically the
    /// on-device WKWebView scrape with its residential IP advantage)
    /// is left intact. Zero risk to working retailers — no legitimate
    /// product title contains these phrases.
    private func mergeScrapedData(_ incoming: ScrapedProduct) {
        if isLikelyBotBlock(incoming) {
            NSLog(
                "%@",
                "[Merge] discarding suspected bot-block scrape: title=\"\(incoming.title ?? "")\"" as NSString
            )
            return
        }
        scrapedProduct = ScrapedProduct(
            title:    scrapedProduct?.title    ?? incoming.title,
            imageUrl: scrapedProduct?.imageUrl ?? incoming.imageUrl,
            price:    scrapedProduct?.price    ?? incoming.price,
            currency: scrapedProduct?.currency ?? incoming.currency,
            siteName: scrapedProduct?.siteName ?? incoming.siteName,
        )
    }

    /// Kick off an on-device WKWebView scrape. Resolves with a ScrapedProduct
    /// (possibly all-nil if the page couldn't be parsed) or nil if the
    /// scraper itself failed to launch / timed out / page errored. The
    /// completion runs on the main queue.
    private func runOnDeviceScrape(
        urlString: String,
        completion: @escaping (ScrapedProduct?) -> Void,
    ) {
        guard let url = URL(string: urlString) else {
            completion(nil)
            return
        }
        let scraper = OnDeviceScraper()
        onDeviceScraper = scraper
        let startedAt = Date()
        scraper.scrape(url: url, host: view) { [weak self] result in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.onDeviceScraper = nil
                let elapsedMs = Int(Date().timeIntervalSince(startedAt) * 1000)
                switch result {
                case .success(let dict):
                    NSLog(
                        "[OnDeviceScrape] success in %dms: title=%@ image=%@ price=%@",
                        elapsedMs,
                        (dict["title"] as? String) ?? "<nil>",
                        (dict["image"] as? String) ?? "<nil>",
                        (dict["price"] as? String) ?? "<nil>",
                    )
                    completion(self.scrapedProductFromOnDeviceDict(dict))
                case .failure(let err):
                    NSLog("[OnDeviceScrape] failed in %dms: %@", elapsedMs, String(describing: err))
                    completion(nil)
                }
            }
        }
    }

    private func scrapedProductFromOnDeviceDict(_ dict: [String: Any]) -> ScrapedProduct {
        return ScrapedProduct(
            title:    (dict["title"] as? String).nonEmpty,
            imageUrl: (dict["image"] as? String).nonEmpty,
            price:    (dict["price"] as? String).nonEmpty,
            currency: (dict["currency"] as? String).nonEmpty,
            siteName: (dict["siteName"] as? String).nonEmpty
        )
    }

    // MARK: - Networking

    private func fetchScrapedProduct(
        url targetUrl: String,
        jwt: String,
        completion: @escaping (Result<ScrapedProduct, String>) -> Void
    ) {
        let endpoint = URL(string: "\(Self.baseURL)/api/trpc/meta.fetch")!
        let body: [String: Any] = ["json": ["url": targetUrl]]
        post(endpoint: endpoint, body: body, jwt: jwt) { data, status, err in
            if let err = err {
                completion(.failure("network: \(err)"))
                return
            }
            guard (200...299).contains(status) else {
                completion(.failure("http \(status)"))
                return
            }
            guard let data = data,
                  let parsed = Self.parseTRPCSingle(data),
                  let dict = parsed as? [String: Any] else {
                completion(.failure("malformed response"))
                return
            }
            let product = ScrapedProduct(
                title:    (dict["title"] as? String).nonEmpty,
                imageUrl: (dict["imageUrl"] as? String).nonEmpty,
                price:    (dict["price"] as? String).nonEmpty,
                currency: (dict["currency"] as? String).nonEmpty,
                siteName: (dict["siteName"] as? String).nonEmpty
            )
            completion(.success(product))
        }
    }

    private func fetchSortlists(
        jwt: String,
        completion: @escaping (Result<[Sortlist], String>) -> Void
    ) {
        // tRPC GET: /api/trpc/collections.list?input=%7B%22json%22%3Anull%7D
        let inputJSON = "{\"json\":null}"
        let encoded = inputJSON.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? inputJSON
        let endpoint = URL(string: "\(Self.baseURL)/api/trpc/collections.list?input=\(encoded)")!
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: request) { data, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if let error = error {
                completion(.failure("network: \(error.localizedDescription)"))
                return
            }
            guard (200...299).contains(status) else {
                completion(.failure("http \(status)"))
                return
            }
            guard let data = data,
                  let parsed = Self.parseTRPCSingle(data),
                  let array = parsed as? [[String: Any]] else {
                completion(.failure("malformed response"))
                return
            }
            let lists: [Sortlist] = array.compactMap { entry in
                guard let id = entry["id"] as? Int,
                      let name = entry["name"] as? String else { return nil }
                let count = entry["itemCount"] as? Int ?? 0
                return Sortlist(id: id, name: name, itemCount: count)
            }
            completion(.success(lists))
        }.resume()
    }

    /// Outcome the SE shows on the success screen. All four fields come
    /// from the products.add response and feed both the user-visible
    /// "Added to <name>" message AND the diagnostic line that helps
    /// debug the shared-sortlist mismatch (we surface productUserId
    /// alongside collectionId so the user can spot the exact moment
    /// userId != collection.ownerId).
    struct SaveOutcome {
        var collectionId: Int?
        var collectionName: String?
        var productId: Int?
        var productUserId: Int?
    }

    private func saveProduct(completion: @escaping (Result<SaveOutcome, String>) -> Void) {
        guard let url = sharedURL, let token = jwt else {
            completion(.failure("missing url/jwt"))
            return
        }

        var input: [String: Any] = ["url": url]
        if let title = scrapedProduct?.title { input["title"] = title }
        if let img = scrapedProduct?.imageUrl { input["imageUrl"] = img }
        if let price = scrapedProduct?.price, !price.isEmpty {
            input["price"] = price
        } else if let manual = manualPriceField.text?
                    .trimmingCharacters(in: .whitespacesAndNewlines),
                  !manual.isEmpty {
            // Scrape didn't return a price; the user filled in the
            // optional field. Send the raw value — backend's price
            // parser strips currency symbols ($, £, €) and normalises
            // formats like "$24.99" / "£24" / "24,99".
            input["price"] = manual
        }
        if let currency = scrapedProduct?.currency { input["currency"] = currency }
        if let site = scrapedProduct?.siteName { input["siteName"] = site }

        switch selectedChoice {
        case .aiDecide:
            input["collectionId"] = NSNull()
        case .existing(let s):
            input["collectionId"] = s.id
        case .createNew:
            let name = (newListField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            input["newCollectionName"] = name
        }

        let endpoint = URL(string: "\(Self.baseURL)/api/trpc/products.add")!
        let body: [String: Any] = ["json": input]
        post(endpoint: endpoint, body: body, jwt: token) { data, status, err in
            if let err = err {
                completion(.failure(err))
                return
            }
            guard (200...299).contains(status) else {
                let bodyStr = data.flatMap { String(data: $0, encoding: .utf8) } ?? "(no body)"
                let snippet = bodyStr.count > 400 ? String(bodyStr.prefix(400)) + "…" : bodyStr
                completion(.failure("HTTP \(status). \(snippet)"))
                return
            }
            // Parse {product, aiSuggestion} — pull the assigned collection id+name.
            guard let data = data,
                  let parsed = Self.parseTRPCSingle(data),
                  let result = parsed as? [String: Any] else {
                completion(.failure("malformed response"))
                return
            }
            // Resolution priority:
            //   1. product.collectionId (if non-null, AI assigned or user picked)
            //   2. aiSuggestion.newSortlistName / aiSuggestion.sortlistId
            let product = result["product"] as? [String: Any]
            let aiSuggestion = result["aiSuggestion"] as? [String: Any]

            var outcome = SaveOutcome()

            if let cid = product?["collectionId"] as? Int {
                outcome.collectionId = cid
            } else if let cid = aiSuggestion?["assignedSortlistId"] as? Int {
                outcome.collectionId = cid
            } else if let cid = aiSuggestion?["sortlistId"] as? Int {
                outcome.collectionId = cid
            }

            // Capture the product's own id + userId for the diagnostic.
            // These come straight from the DB row — if userId differs
            // from what the SE thinks the session user is, that's a
            // smoking gun for the shared-sortlist save bug.
            outcome.productId = product?["id"] as? Int
            outcome.productUserId = product?["userId"] as? Int

            // Name: prefer the AI's "newSortlistName" (it created one),
            // else look up the existing list we picked, else null.
            if let name = aiSuggestion?["newSortlistName"] as? String, !name.isEmpty {
                outcome.collectionName = name
            }

            // Log to NSLog too in case the user can pull device logs later.
            NSLog(
                "[SortlistShareExtension] products.add OK product=%@ user=%@ collection=%@",
                outcome.productId.map(String.init) ?? "?",
                outcome.productUserId.map(String.init) ?? "?",
                outcome.collectionId.map(String.init) ?? "?"
            )

            completion(.success(outcome))
        }
    }

    private func post(
        endpoint: URL,
        body: [String: Any],
        jwt: String,
        completion: @escaping (Data?, Int, String?) -> Void
    ) {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        // Bearer ONLY — server's authenticateRequest does `cookieToken || bearerToken`
        // and a present-but-invalid cookie would shadow the valid Bearer.
        request.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        } catch {
            completion(nil, 0, "encode error: \(error.localizedDescription)")
            return
        }
        URLSession.shared.dataTask(with: request) { data, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if let error = error {
                completion(data, status, error.localizedDescription)
                return
            }
            completion(data, status, nil)
        }.resume()
    }

    /// tRPC v11 non-batched response: `{"result":{"data":{"json": <T>}}}`.
    /// Returns the inner `json` payload (any JSON type) or nil if the shape
    /// doesn't match. Errors come back as `{"error":{"json":{"message":…}}}`
    /// and surface as nil here — caller should also check HTTP status.
    private static func parseTRPCSingle(_ data: Data) -> Any? {
        guard let any = try? JSONSerialization.jsonObject(with: data) else { return nil }
        // tRPC v11 sometimes wraps in an array even without batch=1; tolerate both.
        let envelope: [String: Any]
        if let arr = any as? [Any], let first = arr.first as? [String: Any] {
            envelope = first
        } else if let dict = any as? [String: Any] {
            envelope = dict
        } else {
            return nil
        }
        guard let result = envelope["result"] as? [String: Any],
              let dataDict = result["data"] as? [String: Any] else {
            return nil
        }
        return dataDict["json"]
    }

    // MARK: - Image loading (downsampled to avoid blowing the 120MB SE cap)

    private func loadProductImage(from urlString: String) {
        guard let url = URL(string: urlString) else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data = data, let image = UIImage(data: data) else { return }
            // Downsample to display size. Decoded UIImage bitmaps are
            // W×H×4 bytes; without this a 2000×2000 product photo eats
            // ~16 MB. preparingThumbnail does the downsampling on the
            // ImageIO side, no full-size bitmap ever lives in memory.
            let target = CGSize(width: 144, height: 144)
            let final: UIImage
            if #available(iOS 15.0, *) {
                final = image.preparingThumbnail(of: target) ?? image
            } else {
                final = image
            }
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.productImageView.image = final
                self.productImagePlaceholder.isHidden = true
            }
        }.resume()
    }

    // MARK: - Actions

    @objc private func onSave() {
        guard !didFinish else { return }
        guard isSaveEnabled() else { return }
        inlineError.isHidden = true
        state = .saving
        saveProduct { [weak self] result in
            DispatchQueue.main.async {
                guard let self = self, !self.didFinish else { return }
                switch result {
                case .success(let outcome):
                    self.savedCollectionId = outcome.collectionId
                    self.savedCollectionName = outcome.collectionName ?? self.fallbackCollectionName()
                    self.state = .success
                    // Auto-dismiss the share sheet 1 s after the success
                    // card lands. The user gets a brief visual confirmation
                    // (checkmark + "Added to <name>") and is then dropped
                    // back where they were — usually Safari on the product
                    // page. No buttons, no decisions, no friction.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                        guard let self = self, !self.didFinish else { return }
                        self.didFinish = true
                        self.extensionContext?.completeRequest(
                            returningItems: [],
                            completionHandler: nil
                        )
                    }
                case .failure(let message):
                    self.state = .ready
                    self.inlineError.text = message
                    self.inlineError.isHidden = false
                }
            }
        }
    }

    /// When the server response doesn't tell us a name (rare — usually
    /// happens when the user explicitly picked an existing list), use the
    /// list we picked locally.
    private func fallbackCollectionName() -> String? {
        switch selectedChoice {
        case .existing(let s):
            return s.name
        case .createNew:
            return newListField.text?.trimmingCharacters(in: .whitespacesAndNewlines)
        case .aiDecide:
            return nil
        }
    }

    @objc private func onCancel() {
        if didFinish { return }
        didFinish = true
        readyTimeoutTimer?.invalidate()
        readyTimeoutTimer = nil
        extensionContext?.cancelRequest(withError: NSError(domain: "user.cancel", code: 0))
    }

    private func dismissExtension() {
        if didFinish { return }
        didFinish = true
        readyTimeoutTimer?.invalidate()
        readyTimeoutTimer = nil
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }

    // MARK: - Keychain (JWT read)

    /// Reads the JWT the main app wrote to the shared keychain at sign-in.
    /// History of how we got here:
    ///   - Build 4: bare access-group "com.alexesterkin.sortlist" rejected
    ///     by iOS with errSecMissingEntitlement (-34018). Apple's docs claim
    ///     iOS auto-prepends the team prefix; in practice on iOS 26 / Xcode
    ///     26 it does not. We hard-code the prefixed form here AND in
    ///     lib/session.ts.
    ///   - Build 6: SE was looking up the wrong service name. Now uses
    ///     "sortlist:no-auth" matching what expo-secure-store writes when
    ///     keychainService="sortlist" + no requireAuthentication.
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
        guard status == errSecSuccess,
              let data = item as? Data,
              let token = String(data: data, encoding: .utf8),
              !token.isEmpty else {
            NSLog("[SortlistShareExtension] readJWT: SecItemCopyMatching = %d", status)
            return nil
        }
        return token
    }
}

// MARK: - UITextFieldDelegate (return key dismisses keyboard)

extension ShareViewController: UITextFieldDelegate {
    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        return true
    }
}

// MARK: - Optional<String>.nonEmpty

private extension Optional where Wrapped == String {
    var nonEmpty: String? {
        guard let s = self, !s.isEmpty else { return nil }
        return s
    }
}

// MARK: - Swift.Result<T, String> compatibility
//
// All the SE's networking helpers report failures as plain String messages,
// which means their completion handlers want `Result<T, String>`. Swift's
// stdlib Result requires Failure: Error, but String doesn't conform — so
// we add the conformance here, scoped to this module (the share-extension
// target is its own module, so this can't leak into the host app).
//
// @retroactive suppresses the Swift 5.9+ "you don't own this type" warning
// that would otherwise show up on every build.
extension String: @retroactive Error {}

// MARK: - OnDeviceScraper
//
// Loads a product URL in a hidden WKWebView inside the Share Extension's
// own process, waits a moment for client-side hydration, then runs our
// existing ShareExtensionPreprocessor.js (the same script Safari executes
// during a page-share preprocessing call) to extract OG / JSON-LD /
// retailer-specific metadata.
//
// Why this works where server-side scraping doesn't:
//   - Comes from the user's actual iPhone IP (residential / cellular),
//     not a Railway datacenter IP. Retailers with reputation-based bot
//     defences (Zara Home is the canonical example — returns 403
//     "Access Denied" to every datacenter IP including Playwright
//     running on our server) accept it as a normal page view.
//   - Uses WebKit's real Safari fingerprint, not a headless-browser
//     signature.
//   - Carries no automation-driver markers (no `navigator.webdriver`).
//
// Memory:
//   WKWebView's content rendering happens in a separate Web Content
//   Process spawned by the OS — those pages don't count toward this
//   Share Extension's 120 MB cap. We still tear the view down as soon
//   as the scrape finishes.
//
// Content blockers reduce page weight by skipping ad networks, tracker
// pixels, and webfonts — keeps the SE process's footprint low and speeds
// up the time-to-hydration for tough JS-heavy retailer pages.

final class OnDeviceScraper: NSObject {

    enum ScrapeError: Error, CustomStringConvertible {
        case timeout
        case navigationFailed(String)
        case scriptFailed(String)
        case noUsableResult
        var description: String {
            switch self {
            case .timeout:                return "timeout"
            case .navigationFailed(let m): return "navigation failed: \(m)"
            case .scriptFailed(let m):    return "script failed: \(m)"
            case .noUsableResult:         return "no usable result"
            }
        }
    }

    /// Maximum wall time for the entire scrape attempt (load + hydration
    /// wait + evaluateJavaScript). Tuned conservatively so we don't keep
    /// the user staring at the SE's loading spinner.
    private static let pageLoadTimeoutSec: TimeInterval = 8.0

    /// How long to wait after `didFinish navigation` before invoking the
    /// preprocessor. Most retailer pages inject JSON-LD / OG into <head>
    /// during hydration, which completes within a second of DOM ready;
    /// 1.5s leaves a little slack without dragging the share UX.
    private static let hydrationWaitSec: TimeInterval = 1.5

    private var webView: WKWebView?
    private var completion: ((Result<[String: Any], ScrapeError>) -> Void)?
    private var timeoutWorkItem: DispatchWorkItem?
    private var isFinished = false

    // Compiled once, cached at the type level so subsequent scrapes don't
    // re-pay the compile cost (~50-100 ms).
    private static var cachedRuleList: WKContentRuleList?

    func scrape(
        url: URL,
        host: UIView,
        completion: @escaping (Result<[String: Any], ScrapeError>) -> Void,
    ) {
        self.completion = completion

        let config = WKWebViewConfiguration()
        config.userContentController.removeAllUserScripts()

        // Inject the same JS preprocessor Safari uses. The script declares
        // the `ShareExtensionPreprocessor` class and stores an instance
        // in window.ExtensionPreprocessingJS. We call its scrape() method
        // after the page hydrates.
        if let scriptUrl = Bundle.main.url(
            forResource: "ShareExtensionPreprocessor",
            withExtension: "js",
        ),
           let scriptContent = try? String(contentsOf: scriptUrl) {
            let userScript = WKUserScript(
                source: scriptContent,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true,
            )
            config.userContentController.addUserScript(userScript)
        } else {
            NSLog("[OnDeviceScraper] could not read ShareExtensionPreprocessor.js from bundle")
        }

        Self.compileBlockList { [weak self] ruleList in
            guard let self = self else { return }
            DispatchQueue.main.async {
                if let ruleList = ruleList {
                    config.userContentController.add(ruleList)
                }
                self.startLoad(url: url, config: config, host: host)
            }
        }
    }

    private func startLoad(url: URL, config: WKWebViewConfiguration, host: UIView) {
        let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: config)
        wv.navigationDelegate = self
        // Off-screen but mounted in the view hierarchy. WKWebView won't
        // run JS reliably if it's purely detached.
        wv.alpha = 0
        wv.isUserInteractionEnabled = false
        host.addSubview(wv)
        webView = wv

        // Hard wall clock — give up if the page can't be loaded + scraped
        // within budget.
        let work = DispatchWorkItem { [weak self] in
            self?.finish(.failure(.timeout))
        }
        timeoutWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.pageLoadTimeoutSec, execute: work)

        NSLog("[OnDeviceScraper] loading %@", url.absoluteString)
        wv.load(URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: Self.pageLoadTimeoutSec,
        ))
    }

    private func runScrape() {
        // ExtensionPreprocessingJS is a global set by the injected user
        // script (`var ExtensionPreprocessingJS = new ShareExtensionPreprocessor();`).
        // Calling .scrape() returns a plain JS object; we stringify it on
        // the JS side so Swift gets a deterministic JSON value back.
        let kickoff = "JSON.stringify(ExtensionPreprocessingJS.scrape());"
        webView?.evaluateJavaScript(kickoff) { [weak self] result, error in
            guard let self = self else { return }
            if let error = error {
                self.finish(.failure(.scriptFailed(error.localizedDescription)))
                return
            }
            guard let jsonString = result as? String,
                  let data = jsonString.data(using: .utf8),
                  let dict = (try? JSONSerialization.jsonObject(with: data))
                    as? [String: Any] else {
                self.finish(.failure(.noUsableResult))
                return
            }
            self.finish(.success(dict))
        }
    }

    private func finish(_ result: Result<[String: Any], ScrapeError>) {
        guard !isFinished else { return }
        isFinished = true
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil
        webView?.stopLoading()
        webView?.removeFromSuperview()
        webView?.navigationDelegate = nil
        webView = nil
        let c = completion
        completion = nil
        c?(result)
    }

    /// Minimal block list — kills the heaviest ad/tracker domains and
    /// most webfonts. Goal is to shave hydration time for tough retailer
    /// pages, not to be a full ad-blocker.
    private static func compileBlockList(completion: @escaping (WKContentRuleList?) -> Void) {
        if let cached = cachedRuleList {
            completion(cached)
            return
        }
        let blockListJSON = """
        [
          {"trigger":{"url-filter":"doubleclick\\\\.net"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"google-analytics\\\\.com"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"googletagmanager\\\\.com"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"googletagservices\\\\.com"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"google-syndication\\\\.com"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"facebook\\\\.com/tr"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"facebook\\\\.net"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"hotjar\\\\.com"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"segment\\\\.com"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"criteo\\\\."},"action":{"type":"block"}},
          {"trigger":{"url-filter":"\\\\.ttf$"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"\\\\.otf$"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"\\\\.woff$"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"\\\\.woff2$"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"\\\\.mp4$"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"\\\\.webm$"},"action":{"type":"block"}}
        ]
        """
        WKContentRuleListStore.default()?.compileContentRuleList(
            forIdentifier: "SortlistShareScraperBlocks",
            encodedContentRuleList: blockListJSON,
        ) { ruleList, error in
            if let error = error {
                NSLog("[OnDeviceScraper] block list compile failed: %@", error.localizedDescription)
            }
            cachedRuleList = ruleList
            completion(ruleList)
        }
    }
}

extension OnDeviceScraper: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // DOM is ready. Give client-side hydration a beat to inject the
        // JSON-LD / OG metadata, then run the preprocessor.
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.hydrationWaitSec) { [weak self] in
            self?.runScrape()
        }
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error,
    ) {
        finish(.failure(.navigationFailed(error.localizedDescription)))
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error,
    ) {
        finish(.failure(.navigationFailed(error.localizedDescription)))
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void,
    ) {
        // Block custom-scheme redirects (zara://, fb://, twitter://, …).
        // Retailers' app banners sometimes try to push us into their
        // native app, which would just fail and abort the scrape.
        if let url = navigationAction.request.url,
           let scheme = url.scheme,
           scheme != "http" && scheme != "https" {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}
