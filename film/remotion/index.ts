import { registerRoot } from "remotion";

import { RemotionRoot } from "./Root";

// The film is dark, always. tokens.css puts the light palette behind
// `@media (prefers-color-scheme: light)` on `:root:not([data-theme="dark"])`,
// and a headless browser reports no preference, which resolves to light. Without
// this line the film renders on paper. Setting the attribute rather than forcing
// the media query is also what the site's own theme toggle does, so the film is
// dark for the same reason and by the same mechanism.
document.documentElement.setAttribute("data-theme", "dark");

registerRoot(RemotionRoot);
