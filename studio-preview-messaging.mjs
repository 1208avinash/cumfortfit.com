export function previewMessageTargetOrigin(location) {
  return location.protocol === "file:" ? "*" : location.origin;
}

export function isTrustedPreviewMessage(event, expectedSource, location) {
  return event.source === expectedSource &&
    (location.protocol === "file:"
      ? event.origin === "null"
      : event.origin === location.origin);
}
