# Technical SEO Checklist for New Websites

Every new website launches with a long list of good intentions and a short list of finished technical work. Search engines don't care about the intentions. They care about what they can crawl, render, and understand starting on day one, and most teams find that out the hard way a few months later.

Founders often assume technical SEO can wait until after launch, once there's real traffic worth protecting. That assumption runs backwards: fixing crawl and indexing problems is far cheaper before a site has months of history and thousands of indexed URLs to untangle. Waiting doesn't lower the cost, it just moves the bill later and adds interest.

The checklist that matters most in the first week covers five things: a working robots.txt file, a submitted XML sitemap, correct canonical tags on every page, valid HTTPS with no mixed content warnings, and Core Web Vitals that pass on real mobile devices rather than a synthetic lab test.

## Is Your Robots.txt Blocking the Wrong Pages?

A robots.txt file that blocks staging paths is good; one that accidentally blocks `/blog/` or `/products/` because of a leftover wildcard rule is a launch-week disaster. Google's own documentation on [robots.txt testing](https://developers.google.com/search/docs/crawling-indexing/robots/create-robots-txt) recommends checking the file with the URL inspection tool before and after every deploy, not just once at launch.

## XML Sitemaps: What Belongs and What Doesn't

A sitemap should list only canonical, indexable URLs, not every URL the CMS happens to generate. Sitemaps padded with redirect chains, 404s, or noindexed pages train search engines to trust the sitemap less over time, which slows discovery of the pages that do matter.

## How Are You Handling Duplicate Content?

Canonical tags tell search engines which version of a page is the one to index when several URLs return the same or similar content, like a product page reachable through three different category filters. Missing or self-contradicting canonical tags are one of the most common launch-week errors, showing up on roughly 1 in 4 new e-commerce sites according to a 2023 crawl audit from Screaming Frog.

## Does Your Site Load Fast on an Actual Phone?

Test on a mid-range Android device on a throttled connection, not a laptop on office wifi. A homepage that loads in 1.2 seconds on a MacBook can easily take 6-8 seconds on the hardware most of your traffic actually uses.

Five things to check before calling launch week done:

- robots.txt allows the pages you want indexed
- XML sitemap lists only canonical, live URLs
- Every page has one clear canonical tag
- HTTPS is enforced with no mixed-content warnings
- Core Web Vitals pass on a real mid-range phone
