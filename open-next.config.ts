// OpenNext config for deploying this Next.js app to Cloudflare Workers.
// Kept minimal for the first deploy - no R2 incremental cache binding yet
// (most of this app's dynamic routes already fetch with cache: "no-store"
// for live calendar/radio data, so persistent cross-request caching isn't
// very relevant here). Can add @opennextjs/cloudflare's r2-incremental-cache
// override later if ISR caching becomes worth it.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
