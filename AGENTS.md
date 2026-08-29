# Working on Vraxis Desktop

Vraxis Desktop is shared packaging infrastructure. It turns trusted web applications into secure desktop applications without absorbing product behavior.

## Boundaries

- Own desktop lifecycle, secure web hosting, app metadata, icon validation, and packaging adapters.
- Keep product workflows, prompts, data, and provider credentials inside the product.
- Never enable Node.js integration for remote or product web content.
- Deny permissions and cross-origin navigation unless the manifest explicitly allows them.
- Do not embed secrets in desktop manifests or packaged output.
- Keep every interactive CLI action available as a non-interactive command.

## Verification

- Add unit tests for manifest validation and resolution.
- Add integration tests for CLI behavior and process boundaries.
- Run `npm run check` before release.
- Test the exact packed artifact against at least one adopting Vraxis product before publishing.

Use the `vraxis-ecosystem` skill for cross-product contracts and release coordination.
