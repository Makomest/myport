# RoniGaming - portfolio site

A high-end, dark-themed business-card website for an iGaming slot designer.
Pure HTML, CSS, and vanilla JavaScript. No build step, no dependencies. Open
`index.html` and it works.

Built with the design rules from the [taste-skill](https://github.com/Leonxlnx/taste-skill)
anti-slop frontend skill: one locked blue-to-green accent gradient, dark theme, real images, no
template clichs, fully responsive, reduced-motion safe.

## File map

```
index.html          The landing page (hero, games, about, spin, craft, contact)
game.html           Game detail page, rendered from ?game=<slug>
assets/css/style.css  The whole design system
assets/js/games.js    YOUR CONTENT lives here (the only file you must edit)
assets/js/main.js     Behaviour: nav, scroll reveal, spin, demo modal
```

## How to add or edit a game

Open `assets/js/games.js` and edit the `RONI_GAMES` array. Each game looks like:

```js
{
  slug: "aztec-fortune",          // used in the URL: game.html?game=aztec-fortune
  title: "Aztec Fortune",
  tagline: "Cascading reels deep in the jungle gold.",
  description: "One short paragraph about the game.",
  poster: "https://.../poster.jpg", // ~900x1200 portrait
  shots: ["...", "...", "..."],     // ~1600x1000 screenshots
  rtp: "96.2%",
  volatility: "High",
  layout: "6x5",
  maxWin: "12,000x",
  features: ["Cascading wins", "Free spins"],
  demoUrl: ""                       // see below
}
```

The home grid, the "Feeling lucky" spin, and each game page all read from this
one array. Add an object, it appears everywhere.

## Connecting a real playable demo

Set `demoUrl` to the demo link your game/provider gives you (it loads inside the
"Play demo" pop-up as an iframe). Leave it as `""` and the button shows a polite
"not connected yet" message instead. Example:

```js
demoUrl: "https://demo.yourprovider.com/games/aztec-fortune"
```

## Replace the placeholder images

Every image currently uses `picsum.photos` placeholders so the layout looks
complete. Swap them for your real art:

- Hero art: in `index.html`, the `showcase__card` image.
- About portrait: in `index.html`, the `about__photo` image.
- Game posters and screenshots: in `assets/js/games.js`.

## Contact form

The form in the contact section validates and shows loading / success / error
states. By default (no endpoint set) it opens a prefilled email so it still
works. To collect submissions properly:

1. Create a free form at https://formspree.io and copy its URL.
2. In `assets/js/main.js`, set `FORM_ENDPOINT` to that URL
   (e.g. `var FORM_ENDPOINT = "https://formspree.io/f/abcdwxyz";`).

## Share preview image (OG)

`assets/og.png` (1200x630) is what shows when you paste the link in Telegram /
WhatsApp / X. To change it, edit `assets/og.html` and re-render with Edge:

```
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless --disable-gpu --window-size=1200,630 --screenshot="assets\og.png" "file:///FULL/PATH/assets/og.html"
```

## Fonts

Clash Display and Satoshi are self-hosted in `assets/fonts/` (no network call to
Fontshare). The two most important weights are preloaded for fast first paint.

## Sound

Spin and win play subtle synthesised sounds (no audio files). The speaker button
in the nav toggles sound on/off and remembers the choice.

## Things to personalise before launch

- Email: replace `hello@ronigames.org` in `index.html` (the contact section).
- Social links: the Telegram / X / LinkedIn `href="#"` in the contact section.
- Stats (12 games, 6 studios, 10 yrs) in the About section.
- The bio copy in the About section.

## Deploying (so you can share the link)

Any static host works, no server needed. Easiest options:

- **Netlify**: drag the whole folder onto https://app.netlify.com/drop
- **Cloudflare Pages** or **Vercel**: connect the folder/repo, no build command
- **GitHub Pages**: push the folder to a repo, enable Pages on the branch

Then point your `ronigames.org` domain at the host (each host has a one-page
"custom domain" guide).

## Notes

- The site is dark-mode only by brand intent.
- Motion respects `prefers-reduced-motion` (animations turn off automatically).
- Fonts (Clash Display, Satoshi) load from Fontshare over the network.
