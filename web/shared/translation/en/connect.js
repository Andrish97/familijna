// Tłumaczenia EN — część „connect”.
const en = {
  connectAi: {
    pageTitle: "Familijna — connect an AI assistant",
    title: "Connect an AI assistant",
    wants: "{name} wants access to your Familijna account",
    what: "The assistant will be able to read and change your games, question bases, logos, polls and contacts — just like you on the site. Before it deletes something or sends something to other people, it will ask you in its app.",
    revoke: "You can revoke access in Account settings, in the “AI assistant” section.",
    returnTo: "After you decide, you will return to: {host}",
    allow: "Allow",
    deny: "Deny",
    expired: "This access request has expired or was already handled. Connect the connector again in the assistant’s app.",
    needAccount: "The AI connector works only with a registered account.",
  },
  connectDevice: {
    tv: {
      pageTitle: "Familijna — Connect display",
      title: "Connect display",
      codeLabel: "Enter the code from the Control panel",
      invalidFormat: "Enter the 6-digit code for a Display or a poll QR screen.",
      checking: "Checking code…",
      invalidCode: "The code is invalid or has expired. Check the code in the Control panel.",
      tooManyAttempts: "Too many failed attempts. Try again in a few minutes.",
      wrongDevice: "This is not a display code. The QR screen code from a poll works too.",
      networkError: "Could not connect. Check your internet connection and try again.",
    },
    title: "Familijna — connect device",
    header: {
      title: "Connect device",
      hintMobile: "Connect as Host or Buzzer, or scan the QR code from the Control panel.",
      hintDesktop: "Connect as Display or scan the QR code from the Control panel.",
    },
    scan: {
      btn: "Scan QR",
      cameraError: "Camera access denied.",
      noQr: "No QR code found in the photo.",
      foreignQr: "This QR code does not lead to Familijna.",
    },
    shared: {
      title: "Devices shared with me",
      empty: "No devices shared with you.",
      loading: "Loading…",
      error: "Loading error.",
      gameNotFound: "Game not found.",
      noName: "Untitled",
    },
    deviceType: { host: "Host", buzzer: "Buzzer", display: "Display", pollQr: "QR Display" },
    warning: {
      mobileOnly: "This page works best on a phone or tablet. You may continue.",
      desktopOnly: "This page works best on a desktop or TV. You may continue.",
    },
    enterCode: {
      title: "Connect by code",
      placeholder: "000000",
      btn: "Connect",
      connectBtn: "Connect",
      invalidCode: "Enter a 6-digit code.",
      resolving: "Checking code…",
      codeNotFound: "No device found for this code. Check the code.",
      tooManyAttempts: "Too many failed attempts. Try again in a few minutes.",
      networkError: "Could not connect. Check your internet connection and try again.",
      previewGame: "Game:",
      previewOwner: "Owner:",
    },
  },
};

export default en;
