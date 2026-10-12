// The real Firebase pieces for js/mfa.js, loaded only when two-step sign-in is used (same pinned build as js/auth.js).
let sdk;
export async function loadSdk() {
  if (!sdk) {
    const m = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js');
    sdk = { multiFactor: m.multiFactor, TotpMultiFactorGenerator: m.TotpMultiFactorGenerator, getMultiFactorResolver: m.getMultiFactorResolver };
  }
  return sdk;
}
