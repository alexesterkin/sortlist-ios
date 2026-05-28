// Share Extension JavaScript preprocessor.
//
// Runs in the page context (the actual product page, not the extension's
// sandbox) at the moment the user taps Share → Sortlist. We get DOM
// access to scrape metadata locally — no server round-trip — and we get
// the REAL window.location.href, which fixes a class of bugs where iOS
// Safari otherwise hands the extension a canonical URL or a parent
// category URL instead of the product page the user is actually viewing.
//
// The Swift side reads the returned dictionary via
// kUTTypePropertyList from the extension item attachments and uses it
// to render the preview card immediately.
//
// Fallback chain for each field (mirrors the spec we agreed on):
//   url:       window.location.href                  (always)
//   title:     og:title → twitter:title → ld+json name → document.title
//   image:     og:image → twitter:image → ld+json product image → biggest viewport img
//   price:     og:price:amount → product:price:amount → ld+json offers.price → priced selectors
//   currency:  og:price:currency → ld+json offers.priceCurrency
//   siteName:  og:site_name → application-name → URL host
//
// This file is bundled as a resource inside the .appex bundle and
// referenced from Info.plist's NSExtensionJavaScriptPreprocessingFile.

class ShareExtensionPreprocessor {
  run(extArgs) {
    try {
      extArgs.completionFunction(this.scrape());
    } catch (e) {
      // Never let an exception escape — Safari treats a thrown error as
      // "no preprocessing result" and the SE then loses both the real
      // URL and the scraped metadata. Always return *something* with at
      // least a URL field populated via the same fallback chain
      // scrape() uses, so the Swift side has something to work with
      // even when DOM access blows up mid-scrape on heavy retailer pages
      // (Marks & Spencer, Zara, etc. — see Build 27 incident).
      extArgs.completionFunction({
        url: this.findUrl(),
        error: String(e && (e.message || e)),
      });
    }
  }

  finalize(/* extArgs */) {
    // No teardown.
  }

  scrape() {
    const url = this.findUrl();
    return {
      url: url,
      title: this.findTitle(),
      image: this.findImage(),
      price: this.findPrice(),
      currency: this.findCurrency(),
      siteName: this.findSiteName(url),
    };
  }

  // Robust URL resolver. window.location.href is the obvious source but
  // can be empty/unavailable in edge cases observed on heavy retailer
  // pages: mid-navigation, location getters overridden by site JS,
  // detached document contexts after a long preprocessor wait. document
  // exposes several other authoritative URL views — try them in order
  // and accept the first non-empty one. Returns '' (never undefined)
  // so the caller can rely on a string downstream.
  findUrl() {
    try {
      if (typeof window !== 'undefined' && window.location && window.location.href) {
        return window.location.href;
      }
    } catch (e) { /* ignore */ }
    try {
      if (typeof document !== 'undefined' && document.URL) {
        return document.URL;
      }
    } catch (e) { /* ignore */ }
    try {
      if (typeof document !== 'undefined' && document.documentURI) {
        return document.documentURI;
      }
    } catch (e) { /* ignore */ }
    try {
      if (typeof document !== 'undefined' && document.baseURI) {
        return document.baseURI;
      }
    } catch (e) { /* ignore */ }
    // og:url is the last-resort signal — many retailers (M&S included)
    // emit it server-side, so it's present even if the JS environment
    // is hostile by the time we run.
    try {
      if (typeof document !== 'undefined') {
        const el = document.querySelector('meta[property="og:url" i], meta[name="og:url" i]');
        if (el) {
          const v = (el.getAttribute('content') || '').trim();
          if (v) return v;
        }
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /** Read the first non-empty `meta` content matching property OR name. */
  metaContent() {
    for (let i = 0; i < arguments.length; i++) {
      const key = arguments[i];
      const sel = `meta[property="${key}" i], meta[name="${key}" i]`;
      const el = document.querySelector(sel);
      if (el) {
        const v = (el.getAttribute('content') || '').trim();
        if (v) return v;
      }
    }
    return null;
  }

  findTitle() {
    return (
      this.metaContent('og:title', 'twitter:title') ||
      this.fromJsonLd('name') ||
      (document.title || '').trim() ||
      null
    );
  }

  findImage() {
    return (
      this.metaContent('og:image', 'twitter:image', 'twitter:image:src') ||
      this.fromJsonLd('image') ||
      this.findLargestVisibleImage() ||
      null
    );
  }

  findPrice() {
    const fromMeta = this.metaContent(
      'og:price:amount',
      'product:price:amount',
      'twitter:data1'
    );
    if (fromMeta) return this.normalizePrice(fromMeta);
    const fromLd = this.fromJsonLd('offers.price') || this.fromJsonLd('offers.lowPrice');
    if (fromLd) return this.normalizePrice(String(fromLd));
    // DOM scrape — common selectors. Stop at the first plausible match.
    const selectors = [
      '[itemprop="price"]',
      'meta[itemprop="price"]',
      '[data-testid*="price" i]',
      '[class*="ProductPrice" i]',
      '[class*="product-price" i]',
      '[class*="price-now" i]',
      '[class*="current-price" i]',
      '.a-price .a-offscreen',
      '.a-price-whole',
      '.price',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const raw = (el.getAttribute('content') || el.textContent || '').trim();
      const parsed = this.normalizePrice(raw);
      if (parsed) return parsed;
    }
    return null;
  }

  findCurrency() {
    return (
      this.metaContent('og:price:currency', 'product:price:currency') ||
      this.fromJsonLd('offers.priceCurrency') ||
      this.guessCurrencyFromPriceText() ||
      null
    );
  }

  findSiteName(url) {
    const fromMeta = this.metaContent('og:site_name', 'application-name');
    if (fromMeta) return fromMeta;
    try {
      const u = new URL(url);
      return (u.hostname || '').replace(/^www\./, '') || null;
    } catch (e) {
      return null;
    }
  }

  /** Pull a value at a dotted path out of any JSON-LD script on the page. */
  fromJsonLd(path) {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (let i = 0; i < scripts.length; i++) {
      let raw = scripts[i].textContent || '';
      raw = raw.trim();
      if (!raw) continue;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        continue;
      }
      const candidates = this.flattenLdGraph(parsed);
      for (const node of candidates) {
        const v = this.pickFromPath(node, path);
        if (v) return v;
      }
    }
    return null;
  }

  /** Flatten an ld+json doc into an array of nodes (handles @graph). */
  flattenLdGraph(parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed['@graph'])) return parsed['@graph'];
      return [parsed];
    }
    return [];
  }

  /** Walk a dotted path; resolve string/array/object-with-url to a string. */
  pickFromPath(obj, path) {
    if (!obj || typeof obj !== 'object') return null;
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
      if (cur == null) return null;
      if (Array.isArray(cur) && cur.length > 0) cur = cur[0];
      cur = cur[parts[i]];
    }
    if (cur == null) return null;
    if (typeof cur === 'string') return cur;
    if (typeof cur === 'number') return String(cur);
    if (Array.isArray(cur) && cur.length > 0) {
      const first = cur[0];
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object' && first.url) return first.url;
      if (first && typeof first === 'object' && first.contentUrl) return first.contentUrl;
    }
    if (typeof cur === 'object' && cur.url) return cur.url;
    if (typeof cur === 'object' && cur.contentUrl) return cur.contentUrl;
    return null;
  }

  /**
   * Last-resort image: walk `document.images`, score by area + on-screen
   * boost, return the best src. Avoids 1×1 trackers, sprites, data: URIs.
   */
  findLargestVisibleImage() {
    let best = null;
    let bestScore = 0;
    const vh = window.innerHeight || 800;
    const imgs = document.images || [];
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      if (!img.src || img.src.indexOf('data:') === 0) continue;
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      const area = w * h;
      if (area < 60000) continue; // ignore icons / thumbs
      let score = area;
      try {
        const rect = img.getBoundingClientRect();
        const onScreen = rect.top < vh && rect.bottom > 0;
        if (onScreen) score *= 2;
      } catch (e) {
        // ignore
      }
      if (score > bestScore) {
        bestScore = score;
        best = img.src;
      }
    }
    return best;
  }

  /** Strip whitespace / "from" / currency symbols, keep the numeric part. */
  normalizePrice(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    const match = raw.replace(/[, ]/g, '').match(/\d+(\.\d+)?/);
    return match ? match[0] : null;
  }

  /** "£12.99" → "£" etc. Coarse but useful when meta tags don't help. */
  guessCurrencyFromPriceText() {
    const probes = ['[itemprop="price"]', '.product-price', '.price', '.a-price'];
    for (const sel of probes) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = (el.textContent || '').trim();
      if (!text) continue;
      const m = text.match(/[£$€¥]/);
      if (m) return m[0];
    }
    return null;
  }
}

var ExtensionPreprocessingJS = new ShareExtensionPreprocessor();
