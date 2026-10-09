import { $ } from './dom.js';

export function createFeedback() {
  let noticeTimer;

  function notify(message, error = false) {
    clearTimeout(noticeTimer);
    $('notice').textContent = message;
    $('notice').classList.toggle('error', error);
    $('notice').hidden = false;
    noticeTimer = setTimeout(
      () => {
        $('notice').hidden = true;
      },
      error ? 9000 : 3500,
    );
  }

  function action(handler) {
    return async (event) => {
      try {
        await handler(event);
      } catch (error) {
        notify(error.message, true);
      }
    };
  }

  return { notify, action };
}
