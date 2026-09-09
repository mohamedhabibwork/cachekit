# Publishing

The publish workflow runs after a `v*` tag is pushed. Before the first release:

1. Create the `@mohamedhabibwork` npm organization and grant the repository maintainer publish access.
2. Configure npm trusted publishing for this repository and the `Publish package` workflow, or provide an `NPM_TOKEN` and replace the final workflow step with token authentication.
3. Commit `package-lock.json`, push `main`, then create a tag matching `package.json`, for example `v0.1.2`.

The workflow runs `npm run check` and then `npm publish` with public access and provenance. It deliberately never publishes from pull requests.
