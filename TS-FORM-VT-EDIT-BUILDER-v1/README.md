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
