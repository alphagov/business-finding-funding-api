#!/usr/bin/env bash
#
# Deploys the current commit to Heroku using the Heroku Platform API:
# packages the code, uploads it, builds it, then checks the new release
# starts, stays up and answers /health. If the new release fails those
# checks, the app is rolled back to the release that was live before.
#
# Needs:
#   HEROKU_API_KEY   an API key allowed to deploy the app
#   HEROKU_APP_NAME  the Heroku app to deploy to
#
# Uses git, curl and jq, which are all on GitHub's Ubuntu runners.

set -euo pipefail

: "${HEROKU_API_KEY:?HEROKU_API_KEY is not set}"
: "${HEROKU_APP_NAME:?HEROKU_APP_NAME is not set}"
api="${HEROKU_API_URL:-https://api.heroku.com}"
app_api="$api/apps/$HEROKU_APP_NAME"

# Heroku stops a web dyno that has not started serving within 60 seconds.
boot_timeout_seconds=60

fail() {
  echo "::error::$1"
  exit 1
}

heroku_api() {
  curl --fail-with-body --silent --show-error \
    --header "Accept: application/vnd.heroku+json; version=3" \
    --header "Authorization: Bearer $HEROKU_API_KEY" \
    "$@"
}

# Puts the release that was live before this deploy back. Only used once the
# new release exists: a failed build never replaces the live release.
roll_back() {
  if [ -z "$previous_release" ]; then
    echo "::warning::There is no earlier release to roll back to."
    return 0
  fi
  echo "Rolling back to release $previous_release"
  heroku_api --request POST --header "Content-Type: application/json" \
    --data "$(jq -n --arg release "$previous_release" '{release: $release}')" \
    "$app_api/releases" >/dev/null ||
    echo "::warning::The rollback failed. Roll back by hand with: heroku rollback -a $HEROKU_APP_NAME"
}

fail_and_roll_back() {
  roll_back
  fail "$1"
}

version="$(git rev-parse HEAD)"
archive="$(mktemp)"
trap 'rm -f "$archive"' EXIT

# The release that is live now, so a bad deploy can be undone.
previous_release="$(heroku_api --header "Range: version ..; order=desc,max=10" "$app_api/releases" |
  jq -r '[.[] | select(.current)] | first | .id // empty')"

echo "Packaging $version"
git archive --format=tar.gz --output="$archive" HEAD

echo "Uploading the code to Heroku"
sources="$(heroku_api --request POST "$api/sources")"
put_url="$(jq -r '.source_blob.put_url' <<<"$sources")"
get_url="$(jq -r '.source_blob.get_url' <<<"$sources")"
curl --fail --silent --show-error --request PUT --header 'Content-Type:' \
  --data-binary @"$archive" "$put_url"

echo "Starting the build"
build_request="$(jq -n --arg url "$get_url" --arg version "$version" \
  '{source_blob: {url: $url, version: $version}}')"
build="$(heroku_api --request POST --header "Content-Type: application/json" \
  --data "$build_request" "$app_api/builds")"
build_id="$(jq -r '.id' <<<"$build")"
output_stream_url="$(jq -r '.output_stream_url' <<<"$build")"

# The build log streams until the build finishes. A broken stream does not
# fail the deploy, because the build status below is what counts.
echo "::group::Heroku build log"
curl --silent --show-error --max-time 900 "$output_stream_url" || true
echo "::endgroup::"

status=pending
for _ in $(seq 1 30); do
  build="$(heroku_api "$app_api/builds/$build_id")"
  status="$(jq -r '.status' <<<"$build")"
  [ "$status" != pending ] && break
  sleep 10
done

case "$status" in
  succeeded) ;;
  failed) fail "The Heroku build failed. See the build log above." ;;
  pending) fail "Timed out waiting for the Heroku build to finish." ;;
  *) fail "Unexpected Heroku build status: $status" ;;
esac

release_id="$(jq -r '.release.id' <<<"$build")"
echo "Build succeeded. Waiting for the new release to start."

# Prints how many web dynos are on the new release in the given state.
count_web_dynos() {
  heroku_api "$app_api/dynos" | jq --arg release "$release_id" --arg state "$1" \
    '[.[] | select(.type == "web" and .release.id == $release)] | map(select(.state == $state)) | length'
}

started=false
for _ in $(seq 1 18); do
  if [ "$(count_web_dynos up)" -gt 0 ]; then
    started=true
    break
  fi
  sleep 10
done
[ "$started" = true ] || fail_and_roll_back "The new release did not start within 3 minutes."

# A web dyno that never starts serving is stopped after the boot timeout,
# so check it is still up once that has passed.
sleep "$boot_timeout_seconds"
[ "$(count_web_dynos crashed)" -eq 0 ] || fail_and_roll_back "The new release crashed after starting. Check the Heroku logs."
[ "$(count_web_dynos up)" -gt 0 ] || fail_and_roll_back "The new release is not running. Check the Heroku logs."

# A running dyno does not prove the app answers requests, so ask for /health.
web_url="$(heroku_api "$app_api" | jq -r '.web_url')"
healthy=false
for _ in $(seq 1 6); do
  if curl --fail --silent --max-time 10 "${web_url%/}/health" | jq -e '.status == "ok"' >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 5
done
[ "$healthy" = true ] || fail_and_roll_back "The new release is running but ${web_url%/}/health did not return status ok."

echo "Deployed $version to $HEROKU_APP_NAME"
