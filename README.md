# Lemmy OpenAPI Spec

This is an OpenAPI spec for the Lemmy API. It is used to generate the API docs, and can also used to generate client libraries. I am not affiliated with Lemmy, and it is not guaranteed that this spec is up to date.

## Generating the API spec

You will need `typeconv` to generate the API spec. You can install it with `npm install -g typeconv`.

To generate the API spec, update the `lemmy-js-client` submodule and run `node generate.js`. This will generate the spec in `openapi.json`.

## Disclaimer

I have not fully tested the generated spec, so there may be some issues. If you find any, please open an issue or PR.
