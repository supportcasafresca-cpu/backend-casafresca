# Backend Casa Fresca

Express service for Casa Fresca. The browser talks to this API; it does not connect directly to Firebase or write data to GitHub.

## Local setup

1. Copy `.env.example` to `.env` and set values from the new Casa Fresca Firebase, Cloudinary, and Render setup.
2. Install with `npm ci`.
3. Run `npm test`.
4. Start locally with `npm start`.

The service requires primary and secondary Firebase Realtime Database credentials and URLs and a stable `SESSION_SECRET`. Cloudinary uploads use the `products` and `packs` folders by default. Cloudinary credentials are needed for image uploads, deletions, and usage reporting; without them, the API can start but those functions are unavailable. The mail integration uses `GOOGLE_APPS_SCRIPT_CORREO_URL`; set it to the Casa Fresca Apps Script Web App URL in the private Render environment. Do not commit the value.

## Realtime Database layout

Use two Realtime Database instances in the new Casa Fresca Firebase project, as in the reference backend. Apply `database.rules.json` to both instances: browser clients have no direct read/write access; the server uses Firebase Admin credentials.

Primary instance:

- `/products/{productId}` and `/packs/{packId}`: catalog maps keyed by stable item ID.
- `/ratings/{productId}/votes/{userHash}`: ratings.
- `/notificationBanner`, `/afiliados`, `/mensajes`, `/evento`, `/info/{productId}`, `/pay`: public store configuration served through the API.
- `/admin_auth`: bcrypt password hash and token epoch; never store the plaintext password here.
- `/server_health/uptime_daily`: server uptime counters.

Secondary instance:

- `/pedidos/{orderId}`, `/pedidos_asignados/{assignedId}`, `/orders/{branch}/{orderId}`: incoming, assigned, and managed orders.
- `/estadisticas/{recordId}`: visit analytics.
- `/stats_summary`, `/stats_summary_meta`, `/stats_summary_ips`: incrementally maintained summaries and deduplication state.
- `/known_ips`, `/client_order_index`, `/order_counter/lastNumber`: order/visitor lookup and sequencing metadata.
- `/subscriptions/tokens`: device subscriptions when used by the Casa Fresca app.

The current backend reads whole nodes and does not issue RTDB `orderByChild`/`orderByKey` queries, so no `.indexOn` entries are currently required. If a future query adds those operations, add indexes on the queried child fields to the rules for the relevant path. This is Realtime Database, not Firestore: it has no Firestore collection or composite-index configuration.

## Cloudinary

Uploads are signed by this server using `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`, and are stored in the `products` and `packs` folders in Casa Fresca's own Cloudinary account. The browser never receives the API secret. An unsigned upload preset is not used by this signed-upload flow. Cloudinary configuration is optional at startup, but image upload, deletion, and usage reporting remain unavailable until its credentials are configured.

## Product migration

From this directory, run `npm run migrate:products` for a non-mutating preview. By default, the importer reads environment variables from `backend-casafresca/.env`; pass `--env-file <path>` after the script name to use a different private env file. The importer reads `../Casa-Fresca/Json/products.json` and referenced images in `../Casa-Fresca/Img/products`. Review the product/image counts and any unreferenced files before applying.

To apply, configure the private `.env` with the primary `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_DATABASE_URL`, and Casa Fresca Cloudinary credentials, then run `npm run migrate:products -- --apply`. If your private variables file is stored elsewhere, pass its path, for example `npm run migrate:products -- --env-file ..\\Variables.env --apply`. Never commit private env files. The script uploads referenced images into Cloudinary's `products` folder and writes records keyed by product ID to the primary Realtime Database node `/products`. It normalizes catalog fields expected by the API, preserves legacy storefront fields such as `nuevo`, `created_at`, and `modified_at`, and adds the backend's stock/configuration defaults. It updates only matching product IDs and leaves other existing products and database nodes untouched. Re-running it uses deterministic Cloudinary public IDs and updates the corresponding product records.

The old local statistics/comparison JSON files are retained as backups. Historical orders stored outside this workspace (for example in Apps Script/Sheets) must be exported separately before any import; this script does not read or delete them.

## Render

Create a separate Render Web Service rooted at this directory, install with `npm ci`, and start with `npm start`. Set the environment values in Render, including the actual Casa Fresca site and Analytics origins in `ALLOWED_ORIGINS`, `PUBLIC_SITE_URL`, and `GOOGLE_APPS_SCRIPT_CORREO_URL`. Render supplies `PORT`.
