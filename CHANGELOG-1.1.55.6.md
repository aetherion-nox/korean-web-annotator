# Korean Web Annotator v1.1.55.6 — fix paragraph module loading

Maintenance update on top of v1.1.55.5, based on v1.1.55.4.

## Fixed
- Reverted `web_accessible_resources.use_dynamic_url: true` for extension modules. The prior v1.1.55.4 manifest used stable resource URLs. In some Chrome/Chromium module-import contexts, dynamic web-accessible URLs can trigger content-script CSP or module-loading failures.
- Preserved all module resources introduced for offline LLM-generated Hanja/loanword validation and smart-segmentation repair.
- The paragraph module loader now clears a failed import promise instead of caching the failure for the lifetime of the tab and exposes the underlying error in diagnostics.
- Packaging excludes the duplicate `distribution/` tree and asserts that required modules are present in the ZIP.
- Added regression checks for the manifest, dynamic import resources, and local module dependency graph.

## Installation
Remove or disable the v1.1.55.5 unpacked extension, install v1.1.55.6 as a new unpacked extension, and refresh the affected webpages. Make sure the selected extension folder contains `manifest.json`, `paragraph-plan.js`, `text-chunks.js` and `offline-manual-recovery.js` directly in its root.

## Compatibility
The v1.1.55.5 offline-manual-review protocol remains intact. Existing open tabs should be reloaded after upgrading the unpacked extension.
