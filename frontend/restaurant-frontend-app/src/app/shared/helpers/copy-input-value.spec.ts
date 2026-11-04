import { copyInputValue } from './copy-input-value';

describe('copyInputValue', () => {
  let input: HTMLInputElement;

  beforeEach(() => {
    input = document.createElement('input');
    input.value = 'http://site.test/join/abc';
    document.body.appendChild(input);
  });

  afterEach(() => input.remove());

  it('uses the Clipboard API when it is available', async () => {
    const writeText = spyOn(navigator.clipboard, 'writeText').and.resolveTo();

    await copyInputValue(input);

    expect(writeText).toHaveBeenCalledOnceWith('http://site.test/join/abc');
  });

  describe('without the Clipboard API', () => {
    beforeEach(() => {
      spyOnProperty(navigator, 'clipboard').and.returnValue(undefined as unknown as Clipboard);
    });

    it('selects the value and runs the copy command', async () => {
      const execCommand = spyOn(document, 'execCommand').and.callFake(() => {
        expect(input.value.substring(input.selectionStart!, input.selectionEnd!)).toBe(input.value);
        return true;
      });

      await copyInputValue(input);

      expect(execCommand).toHaveBeenCalledOnceWith('copy');
    });

    it('rejects when the browser refuses the copy command', async () => {
      spyOn(document, 'execCommand').and.returnValue(false);

      await expectAsync(copyInputValue(input)).toBeRejected();
    });
  });
});
