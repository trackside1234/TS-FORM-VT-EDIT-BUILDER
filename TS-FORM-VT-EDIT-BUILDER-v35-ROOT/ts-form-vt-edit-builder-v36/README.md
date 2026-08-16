# TS-FORM VT-EDIT BUILDER

Cloudflare Worker + static browser app for Trackside preview-form edit planning.

## Workflow

1. Choose an upcoming NZ Thoroughbred meeting/date.
2. Choose the upcoming race.
3. Expand any runner to see its `last_starts` form history from the TAB Affiliates API.
4. Click **Add form race** on a historical run.
5. The Worker resolves that run to the complete historical TAB race:
   - first by trying `last_starts[].id` as a TAB event UUID;
   - then by falling back to historical date + venue + stable `horse_id` and searching the races on that date.
6. Once resolved, the app cross-references **all historical runners** against **all runners in the selected upcoming race** by `horse_id`.
7. Every overlap is automatically included as an ARROW using its finishing position in the historical race.
8. Copy the rich edit sheet to Word/Docs.

## Deploy to Cloudflare

Same process as the Review Builder. Put these files at your GitHub repo root (or set this folder as Cloudflare's Root directory):

```
public/
src/
wrangler.toml
package.json
README.md
```

Deploy command:

```
npx wrangler deploy
```

Suggested Worker/project name: `ts-form-vt-edit-builder`.

## Test endpoint

After deploy, open:

`/api/health`

Expected: `{"ok":true,"service":"ts-form-vt-edit-builder","version":1}`

## Notes for this first test build

- Meeting discovery is currently NZ Thoroughbred (`T`) only.
- The UI uses the runner `last_starts` array when TAB supplies it. The API schema marks some detailed form fields as partner/featured-country data, so testing on the live feed will tell us exactly which fields are populated for these NZ upcoming meetings.
- Form race resolution is intentionally defensive and does not depend solely on undocumented `last_starts[].id` behaviour.
- Venue/media-code mappings are inherited from the Review Builder v5 Thoroughbred venue table.
- Historical lookup can be made faster later by adding caching/normalised endpoints after we see real live payloads.


## v2 resolver fix

The historical form-race resolver now:
- matches the historical runner by `horse_id` first;
- falls back to an exact normalized horse-name match;
- accepts multiple meetings response shapes;
- accepts `races` or `events` arrays;
- returns diagnostic counts when resolution fails.

This is specifically to cope with live TAB form payloads where IDs may not line up exactly across upcoming and historical data.


## v3 historical resolver

The resolver now uses `/affiliates/v1/racing/list` for historical lookup rather than relying on the meetings endpoint. The race-list endpoint returns historical race summaries with event IDs and race numbers, which are then fetched individually and matched to the selected horse.

Also added:
- explicit DD/MM/YYYY parsing for form-start dates;
- upstream TAB URL/details in resolver errors;
- health version 3.


## v4 changes

- Historical resolver is tiered: direct start ID -> `/racing/list` -> `/racing/meetings` -> browser-side form-history reconstruction.
- Older TAB dates that reject race-list requests no longer have to fail completely.
- Form-history reconstruction cross-matches all runners in the selected upcoming field by date, venue, distance and class.
- Resolved races now go into an editable staging panel before **Add to Edit Sheet**.
- Historical media code is editable and prefers `last_starts.track_four_char` where available.
- Added practical NZ mappings for Ruakaka/Ruakākā (`WHAN`) and Oamaru (`OMAU`).
- KEY date is now formatted as `AUGUST 1` instead of `2026-08-01`.


## v5 changes

### Historical race-number resolver
The resolver now tries, in order:
1. direct `last_starts[].id` as an event UUID;
2. `/racing/list`;
3. `/racing/races` across Trackside1, Trackside2, Live1, Live2 and NoVideos;
4. `/racing/meetings`;
5. if a historical meeting is available but full event data is not, infer the race number when venue + distance leaves exactly one matching race;
6. finally reconstruct arrows from the upcoming field's own form histories.

The `/racing/races` endpoint is useful because its schema explicitly returns `event_id`, `meeting_name` and `race_number`.

### Internal media codes
`track_four_char` from TAB is no longer used to populate editor media codes. It is a TAB identifier and can conflict with internal media-storage codes.

Media codes are now generated only from actual `venue_name` / `track` text mapped through the user-supplied internal venue-code dictionary. Lookup is normalized for case/accent differences.


## v6 media-code fix

Historical media codes now follow a strict rule:

1. resolve the actual human-readable historical venue;
2. normalize the venue name;
3. map the venue through the internal media-storage venue table;
4. only then build `CODE-R##-DDMMYY`.

TAB `track_four_char` is not referenced anywhere in historical media-code generation.

The staging panel now displays `Internal code: XXXX` under Venue and recalculates the media-code prefix when Venue is edited.

Important NZ aliases include:
- Ruakaka / Ruakākā -> WHAN
- Ellerslie / Pukekohe -> AUCK
- Te Rapa / Cambridge Synthetic -> WAIK
- Riccarton / Riccarton Synthetic -> CBRY
- Rotorua -> ROTU
- Oamaru -> OMAU


## v7 editor-output tweaks

- KEY race name now defaults blank and is optional.
- If blank, the KEY descriptor begins with venue, e.g. `RUAKAKA (SOFT6) 1100M, AUGUST 1`.
- Added EXPORT generator in staging:
  - fixed `rev-` prefix;
  - editable prefix;
  - export date picker formatted `DDMMYY`;
  - selected KEY horse name automatically included.
- Example: `rev-FORM-SHE'S NO SAINT-140826`.
- EXPORT preview updates live when prefix, date, or KEY runner changes.


## v8

### Edit Sheet Setup
Document-level setup is now in the left panel:
- THE FORM -> TF
- WEDNESDAY -> WED
- THURSDAY -> THU
- FRIDAY -> FRI
- BIG SAT -> BIG
- SUNDAY SESH -> SS
- Date selector

All EXPORT lines use:
`rev-PREFIX-SELECTED HORSE-DDMMYY`

### Historical venue/media code
Historical media codes now resolve the human-readable venue first, then map that venue through the internal editor-storage code list. A four-character TAB mnemonic is not treated as a venue where a readable venue is available.

### LOVERACING fallback
For NZ historical starts, after TAB routes fail the Worker attempts a bounded LOVERACING meeting-page lookup to recover the race number using date + venue + distance. TAB remains the source of runner/form data.


## v9 fix

The v8 LOVERACING fallback incorrectly required the incoming TAB venue token (for example `ELLS`) to appear on the LOVERACING page. LOVERACING uses human venue names such as `Ellerslie`, so the correct meeting was being rejected.

v9:
- searches LOVERACING by historical date first;
- scores candidate meetings using horse name + distance;
- extracts the human-readable venue from the LOVERACING page;
- maps known TAB venue mnemonics such as `ELLS` -> `Ellerslie` before internal media-code lookup;
- keeps TAB mnemonics separate from internal editor media codes.

Verified reference case:
State Of Valour — Ellerslie, 7 Mar 2026 — Race 5, Sistema Stakes.


## v10 historical race-number fix

LOVERACING meeting overviews can reflect a provisional programme order that differs from final race numbering.

v10 no longer trusts the overview to determine the race number.

After locating the historical meeting by date, the Worker checks:
`/RaceInfo/{meeting_id}/1/Race-Detail.aspx`
through
`/RaceInfo/{meeting_id}/20/Race-Detail.aspx`

It identifies the correct race by exact normalized horse-name presence and secondarily checks distance.

Reference case:
State Of Valour — Ellerslie — 7 Mar 2026:
- final LOVERACING result page is Race 5, Sistema Stakes;
- State Of Valour finished 3rd.


## v11 project + Word export

Added document/project controls to the left panel:

- **Save Project**
  - downloads a `.json` project file;
  - stores Edit Sheet for, edit date, upcoming date, meeting/race data, current race, expanded runners, staged race and all form races already added to the sheet.

- **Load Project**
  - restores the saved `.json` project back into the browser.

- **Download Word-compatible**
  - downloads a `.doc` file containing the finished edit sheet;
  - includes the sheet heading/date, RACE, ARROWS, KEY and EXPORT lines;
  - keeps silk images in the generated HTML-based Word document where Word permits external image loading.

This v11 includes all v10 historical LOVERACING race-number fixes.


## v12

- Save Project, Load Project and Download Word-compatible moved beside **Copy rich edit sheet**.
- Project/export controls now bind after DOM load and use a more browser-compatible download path.
- Date-picker calendar icon forced white for dark UI.
- LOVERACING race-detail fallback now probes multiple historical URL shapes and only accepts a race number when the selected horse is actually present on that race page.


## v13 race-number fallback

Added Racing & Sports as a final historical race-number source.

After TAB and LOVERACING fail to expose the race number:
1. use the resolved human-readable historical venue;
2. build the Racing & Sports historical result path;
3. probe R1-R20 for that venue/date;
4. find the page containing the selected horse;
5. return that race number.

Reference:
State Of Valour, Ellerslie, 7 Mar 2026 -> R5.

The staging panel now also shows the resolver method and recovered race number.


## v14 — production historical race-number logic

Racing & Sports is now the final verified race-number fallback.

A race number is accepted only when all of these are true:
- exact historical date is encoded in the result URL;
- resolved human venue is encoded in the result URL;
- selected horse appears on that race-result page.

Distance is treated as supporting evidence only, not a hard requirement, because historical feeds can disagree on some race metadata.

If no verified horse match is found, the app leaves `R??` editable rather than guessing.

Examples used to validate the approach:
- State Of Valour — Ellerslie — 7 Mar 2026 -> R5
- Sonar — Otaki — 30 Jul 2026 -> R1
- Tranquil Eyes — Gore — 21 Dec 2025 -> R3


## v15 — historical race-number fix

Racing & Sports is no longer used as a Worker fallback because direct server fetches can return HTTP 403.

The app now uses the same LOVERACING meeting overview that already successfully recovers the human venue. Completed overview pages contain the final race number and full result for each race.

The parser:
1. locates the meeting overview by exact date;
2. extracts the human venue;
3. identifies each `/RaceInfo/{meeting}/{race}/Race-Detail.aspx` section;
4. finds the section containing the selected horse;
5. returns that race number;
6. maps the human venue through the internal media-code table.


## v16 — critical historical fallback fix

A frontend bug was found that explains why recovered race numbers were repeatedly displayed as `R??`.

Previous behaviour:
- Worker fallback successfully returned `event.race.race_number`;
- browser saw `fallback: true`;
- browser discarded `event.race`;
- browser created a fresh provisional historical race with no race number.

v16 now preserves `p.event.race` whenever a fallback resolver supplies it, and only creates a blank provisional race when no event/race was returned.

Also:
- sends raw TAB `track_four_char` separately as `track_code`;
- adds Breednet's predictable `/race-meeting/{trackcode}/{DDMMYY}/{race}` lookup as another fallback;
- adds `TREN -> Trentham` human venue normalisation;
- keeps TAB track codes strictly separate from internal editor media codes.

Key tests:
- State Of Valour, ELLS, 07/03/2026 -> Ellerslie, Race 5.
- State Of Valour, TREN, 28/03/2026 -> Trentham, Race 6.


## v17 — startup fix

v16 contained a frontend JavaScript syntax error in `tabMnemonicToVenue`:
the `YRIO` entry was missing a trailing comma before the new `TREN -> Trentham` entry.

That prevented the browser script from loading at all, which is why meeting selection stopped working.

v17 fixes only that startup error and keeps the v16 historical resolver changes.


## v18 — generic historical race-number resolver

The historical race-number logic is now rule-based rather than dependent on estimated meeting IDs or known examples.

Primary fallback:
1. resolve/humanise the historical venue;
2. build Breednet full-meeting results URL:
   `/race-results/new-zealand/{venue-slug}/{YYYY-MM-DD}`;
3. fetch the whole meeting result once;
4. split it on explicit `Race N -` headings;
5. find the section containing the selected horse;
6. return that race number.

This works independently of horse, date, distance and race class. Distance is not required to identify the race.

Examples of the same generic rule:
- Tranquil Eyes, Gore, 21 Dec 2025 -> page section Race 3.
- State Of Valour, Ellerslie, 7 Mar 2026 -> matching result section.
- State Of Valour, Trentham, 28 Mar 2026 -> matching result section.

LOVERACING remains secondary only; the old meeting-ID estimator is no longer the primary race-number mechanism.


## v19 — optional resolved race name

The staging panel keeps `KEY race name (optional)` blank by default.

If the resolved historical race includes a race description/name, a **Use resolved race name** button appears beside the field. Clicking it fills the KEY race-name field with that resolved race name. If no race name is available, the button is disabled and the field remains manually editable.


## v20 — NZ Harness meeting mode

Adds **Find NZ Harness Meetings** directly under the thoroughbred meeting button.

The existing TAB Affiliates API supports meeting category `H` for Harness, so v20 uses the same no-install / Cloudflare Worker architecture rather than introducing HRNZ API credentials.

Harness workflow mirrors thoroughbreds:
1. choose date;
2. Find NZ Harness Meetings;
3. choose meeting and race;
4. inspect runners and detailed form;
5. choose a historical start;
6. resolve/cross-match overlaps;
7. check/edit media code, KEY and arrows;
8. add to the same edit sheet and export/save/load normally.

Historical TAB searches now carry the selected category (`T` or `H`). Thoroughbred-only external fallbacks (Breednet/LOVERACING) are disabled while in harness mode so they cannot contaminate harness resolution.

Note: HRNZ also publishes a first-class API for meetings, races, results and horse race-starts, but it requires an `X-HR-KEY`. v20 intentionally avoids that extra authentication dependency.


## v21 — HRNZ API harness mode

Harness mode now prefers the official HRNZ Infohorse API.

### Authentication
HRNZ documents `/security/hrkey` as Basic-auth protected. It returns an `hrKey` valid for 60 days. Subsequent API calls send that value in the `X-HR-KEY` header.

Set these two **Cloudflare Worker secrets**:
- `HRNZ_BASIC_USER`
- `HRNZ_BASIC_PASS`

In Cloudflare Dashboard:
Worker → Settings → Variables and Secrets → Add secret.

Do not put the username/password in `wrangler.toml` or the browser frontend.

The Worker:
1. requests `/security/hrkey`;
2. caches the returned key in the Worker isolate;
3. reuses it until near expiry;
4. refreshes it automatically after 401/403;
5. falls back to TAB Harness if HRNZ is not configured or temporarily fails.

### Harness workflow with HRNZ
- `/racing/meetings` finds the date's official meetings.
- `/racing/meetings/{meetingId}` supplies the actual race list.
- `/racing/meetings/{meetingId}/races/{raceId}` supplies runners/results.
- `/equine/horses/{horseId}/raceStarts` supplies detailed historical starts.

Each historical start is normalized with an exact ID:
`hrnz:{meetingId}:{raceId}`

When clicked, the form-race resolver fetches that exact historical race directly. This means harness race-number resolution is ID-based, not inferred from venue/date/distance.

### Status
`/api/hrnz-status` reports whether HRNZ credentials are configured and whether the Worker can obtain a key.

If HRNZ is unavailable, Harness mode continues using the TAB `category=H` flow from v20.


## v22 — HRNZ binding diagnostic + NZ Metro override

### Safe Cloudflare binding diagnostic
New endpoint:

`/api/hrnz-bindings`

It returns binding names only and never exposes any secret value. It also reports:
- `has_HRNZ_BASIC_USER`
- `has_HRNZ_BASIC_PASS`

### Harness venue override
For Harness:
- `NZ Metro` is always displayed/resolved as `ADDINGTON`
- `ADDINGTON` always defaults to internal media code `METT`


## v23 — HRNZ race numbers + Harness media-code table

Two important corrections.

### 1. Harness historical race number is no longer resolved/inferred
HRNZ `/equine/horses/{horseId}/raceStarts` already supplies:
- `raceHeader.raceNumber`
- `raceHeader.meetingId`
- `raceHeader.raceId`
- `raceHeader.raceDate`
- `raceHeader.track`
- `raceHeader.raceName`

v23 keeps those fields directly on each normalized historical start.

Therefore the staging panel can already build the race media code from the historical start itself. Fetching the exact historical race remains useful for all runners/results and ARROW overlap, but it is no longer required merely to discover the race number.

Also corrected HRNZ horse-result parsing: placing/driver/trainer are under `horseResult`, not at the root of a horse-start object.

### 2. Harness venue codes are category-aware
The supplied H venue mappings are now kept separately from Thoroughbred mappings.

Critical NZ Harness mappings:
- ASHT — Ashburton
- AUKG — Manukau
- AUKT — Alexandra Park
- CAMT — Cambridge
- INVT — Invercargill
- MANT — Manawatu
- METT — Addington / NZ Metro
- RANT — Rangiora
- RIVT — Riverton
- WINT — Winton

This avoids collisions such as:
- Cambridge: Harness `CAMT`, Thoroughbred `WAIK`
- Invercargill: Harness `INVT`, Thoroughbred `YRIO`
- Riverton: Harness `RIVT`, Thoroughbred `RIVR`

Historical start rows also display `R#` and the HRNZ race name when available, making it easy to see immediately whether HRNZ supplied the expected race metadata.


## v24 — runtime startup fix

v23 accidentally removed the existing `fillCodeOptions()` frontend helper while replacing `codeForVenue()`.

Because `fillCodeOptions()` is called during page startup, the browser threw a runtime ReferenceError and stopped executing the rest of the app. This prevented upcoming meetings/races from loading even though both JS files passed syntax validation.

v24 restores `fillCodeOptions()` and includes both Thoroughbred and Harness internal codes in the datalist. No HRNZ resolver logic was otherwise changed.


## v25 — full frontend startup restoration

Root cause of the blank date / no-races behaviour was found.

The v23 venue-code replacement accidentally removed the original startup block that:
- populated the venue-code datalist;
- created `todayISO`;
- set `#date` to today;
- set `#editSheetDate` to today;
- defined `updateSetupPreview()`.

v24 restored only `fillCodeOptions()` itself, so startup was still incomplete.

v25 restores the complete startup sequence from the previously working build and moves the HRNZ status fetch out of the Edit Sheet dropdown change handler into normal startup.

Harness/HRNZ parsing and category-aware venue-code changes from v24 are otherwise unchanged.


## v26 — Harness historical race code made start-authoritative

HRNZ's documented horse race-start schema directly includes `raceHeader.raceNumber`, `meetingId`, `raceId`, `raceDate`, `track.name` and `raceName`.

v26 therefore changes Harness historical staging rules:

- race number comes from the selected HRNZ historical start first;
- venue comes from that same selected start first;
- date comes from that same selected start first;
- the historical race fetch is used for full runners/results and ARROWS, but cannot erase known start metadata.

Harness internal media-code lookup is now separate and deterministic for NZ:
- Ashburton -> ASHT
- Manukau -> AUKG
- Alexandra Park / Auckland -> AUKT
- Cambridge -> CAMT
- Invercargill / Ascot Park -> INVT
- Manawatu / Palmerston North -> MANT
- Addington / NZ Metro / NZ Metropolitan -> METT
- Rangiora -> RANT
- Riverton -> RIVT
- Winton / Central Southland Raceway -> WINT

Common `Raceway` naming variants are normalised before lookup.

Diagnostic endpoint added:
`/api/hrnz-horse-starts?horse_id=12345`

This exposes the Worker's normalized HRNZ starts for one horse, including race number and venue, so any remaining mismatch can be identified from actual API data rather than guessed.


## v27 — repack only

No functional changes from v26.

This package is repacked under a new top-level folder name so the Cloudflare root directory can be changed explicitly to:

`ts-form-vt-edit-builder-v27`


## v28 — HRNZ OFFICIAL filter fix + Invercargill normalisation

Concrete HRNZ API bug fixed:
- `raceType` query filter is now `OFFICIAL` (was incorrectly `Official`)
- `meetingType` query filter is now `OFFICIAL` (was incorrectly `Official`)

The HRNZ OpenAPI defines these query enums in uppercase. Returned race objects may use title case, but query values must use the documented enum.

Harness venue normalisation now explicitly handles:
- `Invcargill`
- `Invercargill`
- `Ascot Park`
- `Ascot Park Raceway`

All normalize to:
`INVERCARGILL`

and Harness internal media code:
`INVT`

Historical Harness form rows now append `[HRNZ]` when the start came from the official HRNZ raceStarts endpoint, making it obvious whether race number/venue data is truly coming from HRNZ rather than a TAB fallback.


## v29 — HRNZ raceId fallback + WaikBoP

If an HRNZ horse start has no usable race number, the Worker now uses that start's official `raceId`, searches HRNZ meetings on the exact race date, finds the same raceId in the official meeting, and recovers the race number/meeting/venue from HRNZ.

Venue normalization added:
- WaikBoP -> CAMBRIDGE -> CAMT
- Waikato Bay of Plenty -> CAMBRIDGE -> CAMT

Historical Harness rows identify the source:
- [HRNZ/HORSE_START]
- [HRNZ/RACE_ID_LOOKUP]


## v30 — full NZ club-code table + HRNZ race-number source diagnostics

The full NZ club/code table supplied by the user is embedded in the app.

Matching is category-aware:
- Harness/Trotting -> H map
- Greyhound -> G map
- Racing/Jockey/Turf/Hunt -> T map

Organisational words such as Club, Racing, Harness, Trotting, Jockey, Greyhound and Inc are stripped for the location-first lookup.

Explicit Harness normalisations retained:
- Invcargill / Invercargill / Ascot Park -> INVERCARGILL -> INVT
- WaikBoP / Waikato Bay of Plenty / Bay of Plenty -> CAMBRIDGE -> CAMT
- NZ Metro -> ADDINGTON -> METT

Race-number debugging:
- HRNZ horse-history fetch errors are no longer silently swallowed.
- Historical rows expose HRNZ source + raceId + meetingId.
- `/api/hrnz-horse-starts-raw?horse_id=12345` returns the actual untouched HRNZ payload for comparison.


## v31 — Harness-only historical pipeline rebuild

Thoroughbred logic is intentionally unchanged.

Harness historical form no longer relies on the runner payload's existing `last_starts`.

When a Harness runner is expanded:
1. browser calls `/api/hrnz-runner-history?horse_id=...`;
2. Worker calls HRNZ `/equine/horses/{horseId}/raceStarts`;
3. response is normalized while preserving HRNZ meetingId, raceId, raceNumber, raceDate, venue, placing and participants;
4. runner's historical list is replaced with this HRNZ-only result.

The HRNZ parser accepts direct arrays and common response wrappers instead of assuming one exact top-level response shape.

Each Harness historical row displays:
`HRNZ IDs: race=... · meeting=... · race no=...`

Any HRNZ history error is now visible in the expanded runner rather than silently falling back.

Thoroughbred code paths were not modified.


## v32 — Harness public racebook history fallback

Thoroughbred logic remains unchanged.

The authenticated HRNZ `/equine/horses/{horseId}/raceStarts` endpoint returned HTTP 403 for this account, so v32 no longer uses it when a Harness runner is expanded.

Instead:
1. use the current HRNZ API meeting/race IDs;
2. fetch the matching public HRNZ racebook page;
3. locate the selected horse's `Race Starts (Last 10)` section;
4. parse the visible historical date, club/location, `Race N`, class, distance, condition and placing;
5. feed those enriched starts into the existing staging flow.

This is specifically intended to recover the historical race number that the public racebook visibly provides.

URL construction uses the HRNZ public racebook pattern and prefers the API's numeric clubId. Fallbacks currently cover Auckland (02) and Waikato/Bay of Plenty (09), the two club labels encountered during testing.

Venue/code normalization remains:
- WaikBoP -> CAMBRIDGE -> CAMT
- Invcargill/Invercargill -> INVERCARGILL -> INVT
- NZ Metro -> ADDINGTON -> METT


## v33 — HRNZ current-race ID preservation

Fixes v32's `Current HRNZ meeting/race identifiers are missing`.

- HRNZ compact event now carries explicit `race_id`.
- Generic event normalization preserves `meeting_id` and `race_id`.
- If either is absent but `event_id` has `hrnz:MEETING:RACE`, IDs are recovered from it.
- Harness public-racebook history loader now reports the actual ID values if they are still missing.

No Thoroughbred logic changes.


## v34 — repository-root package

No functional changes from v33.

This ZIP deliberately contains the project files at the ZIP/repository root:
- wrangler.toml
- package.json
- src/
- public/

For Cloudflare Git builds, set Root directory to blank / repository root.


## v35 — TAB-current-race to HRNZ public racebook fallback

The current Harness race can still be TAB-sourced, with UUID event/meeting IDs and no HRNZ race_id.

v35 therefore supports two Harness public-history routes:
1. HRNZ numeric meetingId/raceId when available.
2. TAB current race fallback using current date + venue + race number.

The second route constructs the HRNZ public racebook page without requiring current HRNZ identifiers, then parses the horse's `Race Starts (Last 10)` section.

No Thoroughbred logic changes.

Package remains repository-root layout for Cloudflare.


## v36 — repository-root static assets fix

Cloudflare reached `npx wrangler deploy` but Wrangler could not find static files.

The repository is now root-based, so `wrangler.toml` now points directly to:

`./public`

No functional application changes from v35.


## Cloudflare Git deployment layout

Set the Cloudflare Workers Builds Root directory to:
`ts-form-vt-edit-builder-v36`

This directory contains wrangler.toml, package.json, src/, and public/ at its root.
