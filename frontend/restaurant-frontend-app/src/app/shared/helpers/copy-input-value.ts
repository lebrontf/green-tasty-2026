// navigator.clipboard is undefined on plain HTTP, e.g. the S3 website endpoint.
// Call it directly from a click handler: the copy command needs a user gesture.
export async function copyInputValue(input: HTMLInputElement): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(input.value);
    return;
  }

  input.select();
  if (!document.execCommand('copy')) {
    throw new Error('The browser rejected the copy command.');
  }
}
