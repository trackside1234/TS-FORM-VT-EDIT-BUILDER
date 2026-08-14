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
