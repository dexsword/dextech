# SEO and quote request release

The application changes are prepared on `fix/local-seo-and-inquiries`. Do not edit
the active release or bypass the existing main-SHA, backup, audit, Calendar,
health, or rollback gates.

## Required operator preparation before merging

1. Review the `RUNTIME` change in `ops/deployment/deploy.py`. It adds exactly four
   service HTML pages, `robots.txt`, and `sitemap.xml`, while retaining the
   existing `images/preview.jpg` asset.
   The root-installed `/usr/local/sbin/dextech-deploy` does not update itself.
   A reviewed operator must install this source-contract change before the new
   main release is deployed. Preserve every other installed control-plane change.
   The older release remains active until the normal deployment succeeds.
2. Review `apache-seo.conf`. Copy its rewrite rules inside the HTTPS VirtualHost
   of `/etc/apache2/sites-available/dextech.conf`; change the HTTP vhost redirect
   target to `https://dextech.cloud%{REQUEST_URI}`. Keep the configuration in that
   existing file so the protected snapshot continues to cover it. Run
   `apache2ctl configtest` before a graceful reload. Do not add a separate Include
   or enable additional modules. The proposed full configuration passed syntax
   validation against this host using a temporary configuration file.
3. Merge only after the usual PR checks/review. The main push triggers the
   existing protected deployment. No workflow or environment gate is changed.

The new quote endpoint uses existing SMTP configuration and sends only to the
public Dex Tech business address `dextech.me@gmail.com`. It creates no booking or
Calendar event. No new secrets, analytics account, or database migration is needed.
The endpoint confirms success only after SMTP accepts delivery. Mailbox arrival
still needs a post-release check; SMTP acceptance does not guarantee inbox placement.

## Post-release checks

- Confirm the protected deployment and public release SHA match merged main.
- GET all four new service pages, `/robots.txt`, `/sitemap.xml`, and
  `/images/preview.jpg`; expect 200 and appropriate content types. Verify the
  published robots response includes the sitemap line, including through Cloudflare.
- Check `https://www.dextech.cloud/` and `https://dextech.cloud/index.html?ref=test`
  redirect to the canonical apex homepage and retain the query string.
- Check `/admin`, `/admin.html`, `/cancel`, and `/cancel.html` have `noindex` in
  response headers or HTML. These pages should remain crawlable for that directive.
- Send an owner-initiated quote request with a unique synthetic message and verify
  it arrives in the business inbox. Test replying for an email contact. Verify the
  existing booking flow remains available. Automated tests use a fake transport
  and never send live email or create production bookings.
- Inspect the homepage, new pages, and social image after caches refresh. Avoid
  purging unrelated site content.

## Owner actions for customer acquisition

- Verify/complete Google Business Profile with accurate services, hours, actual
  service area, and the website URL. If customers cannot visit your address, use
  the appropriate service-area setup; do not invent a storefront.
- Verify the Search Console domain property using Google's supplied DNS record.
  Submit `https://dextech.cloud/sitemap.xml` after release, inspect the homepage
  and service URLs, and monitor impressions, clicks, queries, and indexing.
- Ask customers for honest Google reviews after completed work and reply to them.
- Supply an owner introduction, real work photos, and approved testimonials/job
  examples. The website does not invent reviews, qualifications, or work history.
- Confirm current service prices and scope, preferred services to promote, and
  whether coverage extends beyond Henderson before expanding location content.
- Choose analytics if desired. No tracking scripts were added. Track successful
  inquiries, completed bookings, and resulting paid jobs; treat phone-link clicks
  as clicks, not confirmed calls. Update the privacy policy when adding analytics.
- Monitor the business inbox and spam folder for new inquiries and respond promptly.

## Validation

Node 22 application tests cover booking regression behavior, inquiry validation,
email/phone delivery through a fake transport, SMTP rejection, disabled SMTP,
honeypot and rate limits, canonical redirects, noindex headers, sitemap/link
integrity, and browser form state. Chromium checks at 390px and 1440px cover the
homepage and four service pages, overflow, JavaScript errors, and an intercepted
quote submission. No live email or production booking is sent during validation.
