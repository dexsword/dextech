# Residential SEO optimization — November 2026

## Scope and intent

Prioritize residential technology support in Henderson, Nevada: computer troubleshooting, PC tune-ups, virus removal, home Wi-Fi, printers, and device setup. Keep the small-business and custom-build pages useful and distinct. Preserve the approved homepage design, real service descriptions, prices, forms, payment links, and integrations.

## Audit findings and changes

- Existing canonical URLs, homepage redirects, eight-page sitemap, and crawlable HTML were sound. Keep established URLs; no thin location pages or redirects were introduced.
- Add a consistent WebSite identity (Dex Tech / Dex.Tech), page entities, and breadcrumbs matching the visible service-page hierarchy. Rebuild the business offer catalog from all nine visible service cards so names and descriptions agree, including Training & Guidance. Keep confirmed business contact details and Henderson service area; do not invent an address, reviews, qualifications, or expanded coverage.
- Focus homepage, computer-help, and Wi-Fi metadata on residential intent. Keep page titles/descriptions distinct, and synchronize Open Graph and Twitter descriptions, canonical social URLs, and image metadata across all eight public pages.
- Link relevant homepage service titles directly to the existing detailed pages. Preserve separate booking buttons. Replace internal index.html links with the canonical homepage to avoid redirect hops.
- Add native, keyboard-operable home-support questions answering service area, pricing, quote vs. booking, and recurring support. Add contextual computer/Wi-Fi cross-links based on existing service scope. No FAQ rich-result eligibility is claimed.
- Improve blue-button contrast, unavailable calendar-date readability, inline-link underlines, and trust-section heading hierarchy. Preserve existing interactions.
- Load the external font stylesheet without blocking initial rendering, retaining the system fallback and a noscript stylesheet. Give tip-page QR images intrinsic dimensions and lazy loading.
- Add regression coverage for metadata consistency, complete catalog parity, service/page relationships, visible breadcrumbs, and utility-page noindex.

## Baseline observations and limits

A live Lighthouse run passed its basic SEO checks (100); that is not a ranking or indexing guarantee. It identified contrast, heading-order, and inline-link issues. Performance timing from this shared headless server is a lab observation, not field Core Web Vitals. Compare runs under matching conditions and avoid claiming a real-user speed improvement from a single score.

The live CDN injects a Cloudflare analytics beacon that the existing Content Security Policy blocks. This is an existing configuration mismatch, outside the page-content changes. Do not loosen CSP or enable tracking as part of SEO. Review the Cloudflare analytics setting and privacy implications separately.

Unknown URLs return 403 due to the explicit production security allowlist. They are not soft-404 pages and are not linked or included in the sitemap. Do not weaken that allowlist to change the status code. A reviewed operator change could provide a true 404 response while preserving the denial controls.

Admin and cancellation routes are excluded from the sitemap and carry noindex in HTML and/or response headers. They remain crawlable so search engines can read the directive. robots.txt is not an access-control mechanism.

No Search Console account, verified Google Business Profile, search-query data, or field performance data was supplied. No ranking claims, fabricated testimonials, keyword-volume estimates, or external account changes were made.

## Verification and follow-up

Run the repository tests/deployment checks and production dependency audit. Check all eight public pages at phone and desktop widths; check mobile navigation, native FAQ behavior, font loading, no-JavaScript content, all internal targets, exact preservation of pricing/forms/payment links, and booking/quote regressions using isolated transports. After deployment, verify the release SHA, public metadata/schema, sitemap, redirects, utility noindex, live read-only availability, and homepage layout.

Owner/account follow-up:

1. Verify the Search Console domain property and submit https://dextech.cloud/sitemap.xml. Inspect the homepage, computer-help, and Wi-Fi URLs after release. Monitor indexing, queries, clicks, impressions, and inquiry quality over several weeks.
2. Verify the Google Business Profile and accurate service-area setup. Use the real business name, phone, hours, and Henderson coverage; do not publish a storefront address unless customers can actually visit it.
3. Add approved real work photographs and first-hand service examples when available. Request honest customer reviews without incentives or screening.
4. Review field Core Web Vitals when sufficient traffic is available. Decide separately whether analytics should be enabled, and keep the privacy policy consistent with actual tracking.

## Primary references

- https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- https://developers.google.com/search/docs/appearance/site-names
- https://developers.google.com/search/docs/appearance/structured-data/breadcrumb
- https://developers.google.com/search/docs/appearance/structured-data/local-business
