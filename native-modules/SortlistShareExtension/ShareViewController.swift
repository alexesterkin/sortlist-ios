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

final class ShareViewController: UIViewController {

    // MARK: - Constants

    // Keychain. Literal team-prefixed access group — iOS doesn't auto-prepend
    // the team identifier when given the bare form.
    private static let keychainService = "sortlist:no-auth"
    private static let keychainAccount = "sortlist.session_token"
    private static let keychainAccessGroup = "WPX8584UDS.com.alexesterkin.sortlist"

    // Backend
    private static let baseURL = "https://www.sortlist.shop"
    private static let appScheme = "sortlist"  // matches expo.scheme in app.json

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

    // Outcome after save (used by the success screen)
    private var savedCollectionId: Int?
    private var savedCollectionName: String?

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

    // Ready state — picker + form
    private let saveToHeader = UILabel()
    private let pickerButton = UIButton(type: .system)
    private let newListField = UITextField()
    private let saveButton = UIButton(type: .system)
    private let saveSpinner = UIActivityIndicatorView(style: .medium)
    private let cancelButton = UIButton(type: .system)
    private let inlineError = UILabel()

    // Success state
    private let successStack = UIStackView()
    private let successCheckmark = UILabel()
    private let successHeadline = UILabel()
    private let successDetail = UILabel()
    private let goToListButton = UIButton(type: .system)
    private let backToRetailerButton = UIButton(type: .system)

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
            guard let self = self, let url = self.sharedURL else { return }
            self.state = .loading(message: "Fetching product details…")
            self.loadInitialData(url: url, jwt: token)
        }
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

        readyStack.axis = .vertical
        readyStack.spacing = 14
        readyStack.alignment = .fill
        readyStack.addArrangedSubview(productCard)
        readyStack.addArrangedSubview(saveToHeader)
        readyStack.addArrangedSubview(pickerButton)
        readyStack.addArrangedSubview(newListField)
        readyStack.addArrangedSubview(inlineError)
        readyStack.addArrangedSubview(saveButton)
        readyStack.addArrangedSubview(cancelButton)
        readyStack.setCustomSpacing(8, after: saveToHeader)
        readyStack.setCustomSpacing(10, after: pickerButton)
        readyStack.setCustomSpacing(10, after: newListField)
        readyStack.setCustomSpacing(18, after: inlineError)
        readyStack.setCustomSpacing(6, after: saveButton)
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
        successCheckmark.font = UIFont.systemFont(ofSize: 42, weight: .bold)
        successCheckmark.textColor = Self.successHue
        successCheckmark.textAlignment = .center
        successCheckmark.translatesAutoresizingMaskIntoConstraints = false

        successHeadline.text = "Saved!"
        successHeadline.font = UIFont.systemFont(ofSize: 24, weight: .semibold)
        successHeadline.textColor = Self.ink
        successHeadline.textAlignment = .center
        successHeadline.translatesAutoresizingMaskIntoConstraints = false

        successDetail.font = UIFont.systemFont(ofSize: 14)
        successDetail.textColor = Self.inkMuted
        successDetail.textAlignment = .center
        successDetail.numberOfLines = 0
        successDetail.translatesAutoresizingMaskIntoConstraints = false

        styleCoralPrimary(goToListButton, title: "Go to sortlist")
        goToListButton.addTarget(self, action: #selector(onGoToList), for: .touchUpInside)
        goToListButton.translatesAutoresizingMaskIntoConstraints = false

        styleTextButton(backToRetailerButton, title: "Back to where you were")
        backToRetailerButton.addTarget(self, action: #selector(onBackToRetailer), for: .touchUpInside)
        backToRetailerButton.translatesAutoresizingMaskIntoConstraints = false

        successStack.axis = .vertical
        successStack.alignment = .fill
        successStack.spacing = 8
        successStack.addArrangedSubview(successCheckmark)
        successStack.addArrangedSubview(successHeadline)
        successStack.addArrangedSubview(successDetail)
        successStack.addArrangedSubview(goToListButton)
        successStack.addArrangedSubview(backToRetailerButton)
        successStack.setCustomSpacing(4, after: successCheckmark)
        successStack.setCustomSpacing(24, after: successDetail)
        successStack.setCustomSpacing(8, after: goToListButton)
        successStack.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(successStack)

        NSLayoutConstraint.activate([
            successStack.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 24),
            successStack.leadingAnchor.constraint(equalTo: cardView.leadingAnchor, constant: 24),
            successStack.trailingAnchor.constraint(equalTo: cardView.trailingAnchor, constant: -24),
            successStack.bottomAnchor.constraint(equalTo: cardView.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            goToListButton.heightAnchor.constraint(equalToConstant: 52),
            backToRetailerButton.heightAnchor.constraint(equalToConstant: 44),
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
            titleLabel.text = "Saved!"
            if let name = savedCollectionName, !name.isEmpty {
                successDetail.text = "Added to \(name)"
                goToListButton.setTitle("Go to \(name)", for: .normal)
            } else {
                successDetail.text = "Added to Sortlist"
                goToListButton.setTitle("Open Sortlist", for: .normal)
            }
            // Disable the deep-link button if we don't actually have an ID
            // (shouldn't happen in practice but be defensive).
            goToListButton.isEnabled = (savedCollectionId != nil)
            goToListButton.alpha = goToListButton.isEnabled ? 1.0 : 0.5

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
        switch selectedChoice {
        case .createNew: return "Create & Save"
        default:         return "Save to Sortlist"
        }
    }

    @objc private func onNewListChanged() {
        saveButton.isEnabled = isSaveEnabled()
        saveButton.alpha = saveButton.isEnabled ? 1.0 : 0.5
    }

    // MARK: - Share intake

    private func extractSharedItem(completion: @escaping () -> Void) {
        guard let extensionContext = extensionContext else {
            state = .error(message: "No share context.", detail: nil)
            return
        }

        let setAndContinue: (String) -> Void = { [weak self] urlString in
            guard let self = self else { return }
            self.sharedURL = urlString
            completion()
        }

        for item in extensionContext.inputItems {
            guard let extensionItem = item as? NSExtensionItem,
                  let attachments = extensionItem.attachments else { continue }
            for provider in attachments {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { data, _ in
                        DispatchQueue.main.async {
                            if let url = data as? URL {
                                setAndContinue(url.absoluteString)
                            } else if let str = data as? String, let parsed = URL(string: str) {
                                setAndContinue(parsed.absoluteString)
                            } else {
                                self.state = .error(message: "Couldn't read shared URL.", detail: nil)
                            }
                        }
                    }
                    return
                }
                if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { data, _ in
                        DispatchQueue.main.async {
                            if let text = data as? String,
                               let range = text.range(of: #"https?://\S+"#, options: .regularExpression) {
                                setAndContinue(String(text[range]))
                            } else {
                                self.state = .error(message: "No link found in shared text.", detail: nil)
                            }
                        }
                    }
                    return
                }
            }
        }
        state = .error(message: "Nothing shareable found.", detail: nil)
    }

    // MARK: - Initial data load (parallel scrape + list)

    private func loadInitialData(url: String, jwt: String) {
        let group = DispatchGroup()
        var scrape: ScrapedProduct? = nil
        var lists: [Sortlist] = []
        var scrapeErr: String? = nil
        var listsErr: String? = nil

        group.enter()
        fetchScrapedProduct(url: url, jwt: jwt) { result in
            switch result {
            case .success(let p): scrape = p
            case .failure(let msg): scrapeErr = msg
            }
            group.leave()
        }

        group.enter()
        fetchSortlists(jwt: jwt) { result in
            switch result {
            case .success(let ls): lists = ls
            case .failure(let msg): listsErr = msg
            }
            group.leave()
        }

        group.notify(queue: .main) { [weak self] in
            guard let self = self else { return }

            // Sortlists failure is non-fatal — picker just shows AI + create.
            if let err = listsErr {
                NSLog("[SortlistShareExtension] collections.list failed: %@", err)
            }
            self.sortlists = lists

            // Scrape failure is non-fatal — render the card with URL fallback.
            self.scrapedProduct = scrape
            if let err = scrapeErr {
                NSLog("[SortlistShareExtension] meta.fetch failed: %@", err)
                // Don't block the save flow. The user can still save the URL
                // even if we couldn't get a preview.
            }

            self.rebuildPickerMenu()
            self.state = .ready

            // Image loads after we render the card, async.
            if let imgUrl = scrape?.imageUrl, !imgUrl.isEmpty {
                self.loadProductImage(from: imgUrl)
            }
        }
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

    private func saveProduct(completion: @escaping (Result<(collectionId: Int?, collectionName: String?), String>) -> Void) {
        guard let url = sharedURL, let token = jwt else {
            completion(.failure("missing url/jwt"))
            return
        }

        var input: [String: Any] = ["url": url]
        if let title = scrapedProduct?.title { input["title"] = title }
        if let img = scrapedProduct?.imageUrl { input["imageUrl"] = img }
        if let price = scrapedProduct?.price { input["price"] = price }
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

            var collectionId: Int? = nil
            var collectionName: String? = nil

            if let cid = product?["collectionId"] as? Int {
                collectionId = cid
            } else if let cid = aiSuggestion?["assignedSortlistId"] as? Int {
                collectionId = cid
            } else if let cid = aiSuggestion?["sortlistId"] as? Int {
                collectionId = cid
            }

            // Name: prefer the AI's "newSortlistName" (it created one),
            // else look up the existing list we picked, else null.
            if let name = aiSuggestion?["newSortlistName"] as? String, !name.isEmpty {
                collectionName = name
            }

            completion(.success((collectionId: collectionId, collectionName: collectionName)))
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
        extensionContext?.cancelRequest(withError: NSError(domain: "user.cancel", code: 0))
    }

    @objc private func onGoToList() {
        guard let id = savedCollectionId else { return }
        // Two-hop deep link:
        //   1. sortlist://navigate?url=...   — handled by lib/deep-link.ts
        //                                       in the React app.
        //   2. The encoded URL is the actual web destination the home-tab
        //      WebView should load.
        // Deep-link handler validates the inner URL against an allowlist
        // (sortlist.shop apex/www only) before forwarding to the WebView,
        // so a hostile re-use of this scheme can't redirect to arbitrary
        // domains.
        let webDestination = "\(Self.baseURL)/sortlist/\(id)"
        let allowed = CharacterSet.urlQueryAllowed
        let encoded = webDestination.addingPercentEncoding(withAllowedCharacters: allowed) ?? webDestination
        let urlStr = "\(Self.appScheme)://navigate?url=\(encoded)"
        guard let url = URL(string: urlStr) else {
            // Last resort — just dismiss.
            dismissExtension()
            return
        }
        // Apple's only blessed way for a share extension to open a URL in
        // the host app. We complete first, then open — that matches the
        // pattern Apple recommends for "I'm done, but route the user
        // somewhere else."
        didFinish = true
        extensionContext?.completeRequest(returningItems: []) { _ in
            self.openURLViaResponderChain(url)
        }
    }

    @objc private func onBackToRetailer() {
        // "Back to where you were" = dismiss the sheet. Safari is still
        // underneath; iOS will reveal it.
        dismissExtension()
    }

    private func dismissExtension() {
        if didFinish { return }
        didFinish = true
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }

    /// Walk the responder chain looking for an object that handles
    /// `openURL:` — UIApplication does, but app extensions can't reference
    /// it directly. This is the historical workaround; still works on
    /// iOS 26.
    private func openURLViaResponderChain(_ url: URL) {
        var responder: UIResponder? = self
        let selector = sel_registerName("openURL:")
        while let r = responder {
            if r.responds(to: selector) {
                r.perform(selector, with: url)
                return
            }
            responder = r.next
        }
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
