/** The calmer look (Me → Settings and help): less glow and no animations, remembered on this phone. */
export const CALM_KEY = "turmoil-calm";

/** Runs in the page head before anything is drawn, so a calm phone never flashes the glow. */
export const CALM_SCRIPT = `try{if(localStorage.getItem("${CALM_KEY}")==="1")document.documentElement.dataset.calm="true"}catch(e){}`;

export function isCalm(): boolean {
  try { return document.documentElement.dataset.calm === "true" || window.localStorage.getItem(CALM_KEY) === "1"; } catch { return false; }
}

export function setCalm(on: boolean) {
  if (on) document.documentElement.dataset.calm = "true";
  else delete document.documentElement.dataset.calm;
  try {
    if (on) window.localStorage.setItem(CALM_KEY, "1");
    else window.localStorage.removeItem(CALM_KEY);
  } catch { /* private mode: this visit only */ }
}
