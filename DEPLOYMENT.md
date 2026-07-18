# Deployment status

The implementation is complete and tested locally.

Target repository: `SankhipKate/immigration-country-matcher`

Target public URL after the files are placed in `main`:

`https://sankhipkate.github.io/immigration-country-matcher/pilot/`

## Files to add

- `.github/workflows/test.yml`
- `data/research-package-v2.2.schema.json`
- `data/spain-research-v2.2.json`
- `js/spain-calculator.js`
- `package.json`
- `pilot/app.js`
- `pilot/index.html`
- `pilot/styles.css`
- `tests/spain-calculator.test.mjs`

## File to replace

- `README.md`

## Verification completed

- `npm test`: 10/10 tests passed.
- JavaScript syntax checks passed.
- Spain JSON passed JSON Schema v2.2.
- Pilot HTML parsed successfully.
- Local HTTP requests for `/pilot/` and the Spain JSON returned HTTP 200.

## GitHub connector result

The connected GitHub integration returned HTTP 403 `Resource not accessible by integration` for both branch creation and file creation. Repository write permission must be enabled for the integration before automated publication.
